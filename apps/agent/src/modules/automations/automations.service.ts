import type {
  AutomationAction,
  AutomationCondition,
  AutomationRule,
  AutomationRun,
  AutomationTrigger,
  CreateAutomationRuleRequest,
  HomeEvent,
  IotManager,
  UpdateAutomationRuleRequest,
} from '@krakenos/types';
import { IOT_ROOM } from '@krakenos/types';
import type { AutomationRule as DbAutomationRule, AutomationRun as DbAutomationRun } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { withActionTimeout } from '../../iot/action-timeout.js';
import { createTickLoop, type TickLoop } from '../../system/tick-loop.js';
import type { HomeEventBus } from '../../automations/event-bus.js';
import {
  describeEvent,
  dueRulesForEvent,
  dueTimeRules,
  eventSubject,
} from '../../automations/engine.js';
import type { IotWatcher } from '../../automations/iot-watcher.js';
import type { AccessScheduleService } from '../access/access.service.js';
import type { InventoryService } from '../inventory/inventory.service.js';
import type { SceneService } from '../scenes/scenes.service.js';

/**
 * Proyección DB→API con parseo defensivo (patrón US-63): una fila con
 * `trigger`/`actions` corruptos se degrada a deshabilitada con valores inertes.
 */
function toRule(row: DbAutomationRule, log?: FastifyInstance['log']): AutomationRule {
  let trigger: AutomationTrigger | null = null;
  let actions: AutomationAction[] | null = null;
  let condition: AutomationCondition | undefined;
  try {
    trigger = JSON.parse(row.trigger) as AutomationTrigger;
  } catch {
    trigger = null;
  }
  try {
    const parsed = JSON.parse(row.actions) as AutomationAction[];
    actions = Array.isArray(parsed) ? parsed : null;
  } catch {
    actions = null;
  }
  if (row.condition) {
    try {
      condition = JSON.parse(row.condition) as AutomationCondition;
    } catch {
      condition = undefined;
    }
  }
  const corrupt = trigger === null || actions === null;
  if (corrupt) {
    log?.warn({ rule: row.id }, '[automations] regla corrupta; se degrada a deshabilitada');
  }
  return {
    id: row.id,
    name: row.name,
    enabled: corrupt ? false : row.enabled,
    trigger: trigger ?? { type: 'device-new' },
    ...(condition !== undefined ? { condition } : {}),
    actions: actions ?? [],
    cooldownSec: row.cooldownSec,
    createdAt: row.createdAt.toISOString(),
  };
}

function toRun(row: DbAutomationRun): AutomationRun {
  return {
    id: row.id,
    ruleId: row.ruleId,
    event: row.event,
    ok: row.ok,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface AutomationDeps {
  iot: IotManager;
  scenes: SceneService;
  inventory: InventoryService;
  access: AccessScheduleService;
  bus: HomeEventBus;
  /** Watcher IoT (para el anti-bucle de `iot-set`); opcional en tests. */
  watcher?: IotWatcher;
  /** Envío de la acción `notify`; por defecto push a todos (US-45). */
  notify?: (title: string, body: string) => Promise<void>;
}

/**
 * Automatizaciones «si X entonces Y» (US-167): CRUD + ejecución. Se suscribe al
 * bus de eventos del hogar y corre un barrido por minuto para los disparadores
 * de hora. La decisión de qué dispara vive en `automations/engine.ts` (puro);
 * aquí se ejecutan las acciones (best-effort, con timeout por acción, US-203) y
 * se registra cada ejecución en `AutomationRun`.
 */
export class AutomationService {
  private loop: TickLoop | null = null;
  /** Instante del barrido horario anterior (disparo por cruce, como US-168). */
  private prevTick: Date | null = null;
  /** Último disparo por regla (cooldown). En memoria: un reinicio lo resetea. */
  private readonly lastFired = new Map<string, number>();

  constructor(
    private readonly app: FastifyInstance,
    private readonly deps: AutomationDeps,
  ) {
    deps.bus.subscribe((event) => this.onEvent(event));
  }

  // ---- CRUD ----

  async list(): Promise<AutomationRule[]> {
    const rows = await this.app.prisma.automationRule.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map((row) => toRule(row, this.app.log));
  }

  async create(body: CreateAutomationRuleRequest): Promise<AutomationRule> {
    const row = await this.app.prisma.automationRule.create({
      data: {
        name: body.name,
        enabled: body.enabled ?? true,
        trigger: JSON.stringify(body.trigger),
        condition: body.condition ? JSON.stringify(body.condition) : null,
        actions: JSON.stringify(body.actions),
        ...(body.cooldownSec !== undefined ? { cooldownSec: body.cooldownSec } : {}),
      },
    });
    return toRule(row, this.app.log);
  }

  async update(id: string, patch: UpdateAutomationRuleRequest): Promise<AutomationRule | null> {
    const existing = await this.app.prisma.automationRule.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await this.app.prisma.automationRule.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.trigger !== undefined ? { trigger: JSON.stringify(patch.trigger) } : {}),
        ...(patch.condition !== undefined
          ? { condition: patch.condition === null ? null : JSON.stringify(patch.condition) }
          : {}),
        ...(patch.actions !== undefined ? { actions: JSON.stringify(patch.actions) } : {}),
        ...(patch.cooldownSec !== undefined ? { cooldownSec: patch.cooldownSec } : {}),
      },
    });
    return toRule(row, this.app.log);
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.app.prisma.automationRule.findUnique({ where: { id } });
    if (!existing) return false;
    await this.app.prisma.automationRule.delete({ where: { id } });
    return true;
  }

  /** Últimas ejecuciones (log), opcionalmente filtradas por regla. */
  async listRuns(ruleId?: string, limit = 50): Promise<AutomationRun[]> {
    const rows = await this.app.prisma.automationRun.findMany({
      ...(ruleId ? { where: { ruleId } } : {}),
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(toRun);
  }

  // ---- Motor ----

  /** Maneja un evento del bus: dispara las reglas que casan. */
  async onEvent(event: HomeEvent, now: Date = new Date()): Promise<void> {
    try {
      const due = dueRulesForEvent(await this.list(), event, now, this.lastFired);
      for (const rule of due) {
        await this.fire(rule, event, now);
      }
    } catch (err) {
      this.app.log.error({ err, event: event.type }, '[automations] fallo procesando el evento');
    }
  }

  /** Barrido por minuto para los disparadores de hora (cruce, como US-168). */
  async tick(now: Date = new Date()): Promise<void> {
    const prev = this.prevTick;
    // La lectura va ANTES de mover la ventana (US-229 / AUD3-18): si falla, el
    // minuto se reintenta en vez de quedarse sin disparar y sin error visible.
    const rules = await this.list();
    this.prevTick = now;
    if (!prev) return; // primer barrido: fija la base, no dispara nada atrasado

    for (const rule of dueTimeRules(rules, prev, now, this.lastFired)) {
      await this.fire(rule, null, now);
    }
  }

  /**
   * Ejecuta las acciones de una regla (best-effort: un fallo no aborta el resto
   * ni tumba el motor) y registra la ejecución. El cooldown corre desde el
   * intento, no desde el éxito (una regla que falla no debe ametrallar).
   */
  private async fire(rule: AutomationRule, event: HomeEvent | null, now: Date): Promise<void> {
    this.lastFired.set(rule.id, now.getTime());
    const subject = event ? eventSubject(event) : {};
    const failures: string[] = [];

    for (const action of rule.actions) {
      try {
        await this.runAction(rule, action, subject);
      } catch (err) {
        failures.push(`${action.type}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const summary = event ? describeEvent(event) : 'hora programada';
    const ok = failures.length === 0;
    try {
      await this.app.prisma.automationRun.create({
        data: { ruleId: rule.id, event: summary, ok, detail: ok ? null : failures.join(' · ') },
      });
    } catch (err) {
      this.app.log.warn({ err, rule: rule.id }, '[automations] no se pudo registrar la ejecución');
    }
    this.app.audit({
      action: 'automation.fire',
      detail: `${rule.id} · ${rule.name} · ${ok ? 'ok' : `${failures.length} fallo(s)`}`,
    });
  }

  private async runAction(
    rule: AutomationRule,
    action: AutomationAction,
    subject: { mac?: string; deviceId?: string },
  ): Promise<void> {
    switch (action.type) {
      case 'iot-set': {
        const deviceId = action.deviceId ?? subject.deviceId;
        if (!deviceId) throw new Error('la regla no aporta un dispositivo IoT objetivo');
        const device = await withActionTimeout(() =>
          this.deps.iot.setState(deviceId, {
            ...(action.on !== undefined ? { on: action.on } : {}),
            ...(action.brightness !== undefined ? { brightness: action.brightness } : {}),
          }),
        );
        this.app.io.to(IOT_ROOM).emit('iot:device-updated', device);
        // Anti-bucle: la transición que acabamos de causar se publica con la
        // procedencia de esta regla (y el watcher no la re-publica sin ella).
        for (const caused of this.deps.watcher?.applyKnownState(device) ?? []) {
          this.deps.bus.publish({ ...caused, origin: `automation:${rule.id}` });
        }
        return;
      }
      case 'scene-run': {
        const result = await this.deps.scenes.run(action.sceneId);
        if (!result) throw new Error('la escena no existe');
        if (result.failed.length > 0) {
          throw new Error(`escena con ${result.failed.length} fallo(s) parciales`);
        }
        return;
      }
      case 'device-block': {
        const mac = action.mac ?? subject.mac;
        if (!mac) throw new Error('la regla no aporta un dispositivo de red objetivo');
        const row = await this.app.prisma.device.findUnique({ where: { mac } });
        if (!row) throw new Error(`dispositivo ${mac} no encontrado`);
        await this.deps.inventory.setBlocked(row.id, true);
        return;
      }
      case 'device-unblock': {
        const mac = action.mac ?? subject.mac;
        if (!mac) throw new Error('la regla no aporta un dispositivo de red objetivo');
        const row = await this.app.prisma.device.findUnique({ where: { mac } });
        if (!row) throw new Error(`dispositivo ${mac} no encontrado`);
        // Suelta SOLO el bloqueo manual. Si un horario o una pausa siguen activos,
        // el aparato sigue sin internet: el bloqueo efectivo es un OR de tres
        // fuentes (`blocked-eval.ts`) y esta acción no puede —ni debe— pisar las
        // otras dos. Prometer «desbloquear» y saltarse la hora de dormir de un
        // menor sería justo la clase de sorpresa que el parental no puede dar.
        await this.deps.inventory.setBlocked(row.id, false);
        return;
      }
      case 'device-pause': {
        const mac = action.mac ?? subject.mac;
        if (!mac) throw new Error('la regla no aporta un dispositivo de red objetivo');
        await this.deps.access.pause(mac, action.minutes);
        return;
      }
      case 'notify': {
        const send =
          this.deps.notify ??
          (async (title: string, body: string) => {
            if (!this.app.push) throw new Error('notificaciones push no disponibles');
            await this.app.push.sendToAll(title, body, '/automations');
          });
        await send(rule.name, action.message);
        return;
      }
    }
  }

  start(intervalMs = 60_000): void {
    if (this.loop) return;
    this.loop = createTickLoop({
      intervalMs,
      immediate: true, // fija prevTick
      tick: () => this.tick(),
      onError: (err) =>
        this.app.log.error({ err }, '[automations] el barrido horario falló; se omite este ciclo'),
      onSkip: () =>
        this.app.log.warn('[automations] el barrido anterior sigue en curso; se salta este ciclo'),
    });
    this.loop.start();
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
  }
}
