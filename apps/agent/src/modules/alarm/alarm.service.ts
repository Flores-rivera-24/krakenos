import type { AlarmConfig, AlarmMachineState, AlarmMode, AlarmState, HomeEvent, IotDevice, IotManager, UpdateAlarmConfigRequest } from '@krakenos/types';
import { isLifeSafetyMetric, isSecurityMetric } from '@krakenos/types';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import type { HomeEventBus } from '../../automations/event-bus.js';
import { withActionTimeout } from '../../iot/action-timeout.js';
import { settleWithLimit } from '../../iot/batch.js';
import { advance, arm, disarm, disarmedState, isActive, trigger, type TriggerOptions } from '../../alarm/state-machine.js';
import { decideAvisoVital, detalleDeAviso } from '../../alarm/life-safety.js';
import { createTickLoop, type TickLoop } from '../../system/tick-loop.js';

/** Periodo del fail-safe de sensores (el barrido en sí corre cada segundo). */
const FAIL_SAFE_INTERVAL_MS = 30_000;

const CONFIG_KEY = 'alarm.config';
const STATE_KEY = 'alarm.state';
const PIN_KEY = 'alarm.pin';

/** Config por defecto: sin dispositivos, gracias de 30 s, sin auto-armado. */
export const DEFAULT_ALARM_CONFIG: Omit<AlarmConfig, 'hasPin'> = {
  sirenDeviceId: null,
  lightDeviceIds: [],
  sensorDeviceIds: [],
  cameraIds: [],
  exitDelaySec: 30,
  entryDelaySec: 30,
  autoArmAway: false,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string') : [];
}

/** Normaliza la config cruda (defensivo, patrón US-63). Puro. `hasPin` se añade aparte. */
export function normalizeAlarmConfig(raw: unknown): Omit<AlarmConfig, 'hasPin'> {
  const r = (raw ?? {}) as Record<string, unknown>;
  return {
    sirenDeviceId: typeof r.sirenDeviceId === 'string' ? r.sirenDeviceId : null,
    lightDeviceIds: strArray(r.lightDeviceIds),
    sensorDeviceIds: strArray(r.sensorDeviceIds),
    cameraIds: strArray(r.cameraIds),
    exitDelaySec: clampInt(r.exitDelaySec, 0, 300, DEFAULT_ALARM_CONFIG.exitDelaySec),
    entryDelaySec: clampInt(r.entryDelaySec, 0, 300, DEFAULT_ALARM_CONFIG.entryDelaySec),
    autoArmAway: typeof r.autoArmAway === 'boolean' ? r.autoArmAway : false,
  };
}

/**
 * Alarma del hogar (US-188). Máquina de estados **pura** (`alarm/state-machine.ts`)
 * + los efectos aquí: persiste el estado en `Setting`, arma/desarma (PIN bcrypt),
 * escucha el bus (movimiento de cámara / sensores IoT / modo `away`), avanza las
 * cuentas atrás de salida/entrada en el barrido y, al dispararse, ejecuta las
 * acciones (sirena, luces, aviso urgente auditado). **Fail-safe**: un sensor
 * vigilado que se cae estando armada avisa (`alarm.sensor_fault`) — no se ignora
 * en silencio. El desarme se audita.
 */
export class AlarmService {
  // `requiresPin` NO vive aquí: es una propiedad de la CONFIG (¿hay PIN puesto?),
  // no del estado de la máquina. Se compone al salir por la API (US-235).
  private state: AlarmMachineState;
  private loop: TickLoop | null = null;
  private readonly faultNotified = new Set<string>();
  /** Fail-safe de los detectores de humo/CO (US-245): dedupe propio, porque su
   *  vigilancia **no** se limpia al desarmar como la de los sensores de intrusión. */
  private readonly faultNotifiedVital = new Set<string>();
  /** Último aviso de humo/CO por aparato+métrica (ms), para la ventana de rearme. */
  private readonly ultimosAvisosVitales = new Map<string, number>();
  /** Último fail-safe ejecutado (ms). `-Infinity` → el primer barrido lo corre. */
  private lastFailSafeMs = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly app: FastifyInstance,
    private readonly iot: IotManager,
    private readonly bus: HomeEventBus,
    private readonly opts: { intervalMs?: number; now?: () => number } = {},
  ) {
    this.state = disarmedState(this.now());
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  // ---- Config ----

  private async hasPin(): Promise<boolean> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: PIN_KEY } });
    return !!row?.value;
  }

  async getConfig(): Promise<AlarmConfig> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: CONFIG_KEY } });
    let base = DEFAULT_ALARM_CONFIG;
    if (row) {
      try {
        base = normalizeAlarmConfig(JSON.parse(row.value));
      } catch {
        this.app.log.warn('[alarm] ajuste alarm.config corrupto; se usan valores por defecto');
      }
    }
    return { ...base, hasPin: await this.hasPin() };
  }

  async setConfig(patch: UpdateAlarmConfigRequest): Promise<AlarmConfig> {
    const current = await this.getConfig();
    const next = normalizeAlarmConfig({ ...current, ...patch });
    await this.app.prisma.setting.upsert({
      where: { key: CONFIG_KEY },
      create: { key: CONFIG_KEY, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });
    // PIN: string lo pone (hasheado), null lo quita, ausente no lo toca.
    if (patch.pin === null) {
      await this.app.prisma.setting.deleteMany({ where: { key: PIN_KEY } });
    } else if (typeof patch.pin === 'string' && patch.pin.length > 0) {
      const hash = await bcrypt.hash(patch.pin, 10);
      await this.app.prisma.setting.upsert({
        where: { key: PIN_KEY },
        create: { key: PIN_KEY, value: hash },
        update: { value: hash },
      });
    }
    return { ...next, hasPin: await this.hasPin() };
  }

  // ---- Estado ----

  /**
   * Estado público de la alarma. Incluye `requiresPin` (US-235) para que la UI
   * pueda pedir el PIN **antes** de intentarlo, en vez de descubrirlo con un 401
   * mientras suena la sirena. Es un booleano: el PIN sigue sin salir nunca.
   */
  async getState(): Promise<AlarmState> {
    return { ...this.state, requiresPin: await this.hasPin() };
  }

  /** Estado en memoria, sin consultar el PIN. Para los caminos internos. */
  getStateSync(): AlarmMachineState {
    return this.state;
  }

  private async persist(): Promise<void> {
    await this.app.prisma.setting.upsert({
      where: { key: STATE_KEY },
      create: { key: STATE_KEY, value: JSON.stringify(this.state) },
      update: { value: JSON.stringify(this.state) },
    });
  }

  /** Rehidrata el estado desde `Setting` al arrancar (no re-dispara acciones). */
  async reconcile(): Promise<void> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: STATE_KEY } });
    if (!row) return;
    try {
      const parsed = JSON.parse(row.value) as AlarmState;
      if (parsed && typeof parsed.phase === 'string') this.state = parsed;
    } catch {
      this.app.log.warn('[alarm] estado alarm.state corrupto; se asume desarmada');
    }
  }

  // ---- Armar / desarmar ----

  async armAlarm(mode: AlarmMode, by: string): Promise<AlarmState> {
    const config = await this.getConfig();
    this.state = arm(mode, this.now(), config);
    this.faultNotified.clear();
    await this.persist();
    // El armado manual lo audita la ruta (con actor+ip); el auto-armado por modo sí aquí.
    if (by === 'modo away') this.app.audit({ action: 'alarm.armed', detail: `${mode} · ${by}` });
    return this.getState();
  }

  /** Verifica el PIN (si lo hay) y desarma. Lanza `AlarmPinError` si el PIN falla. */
  async disarmAlarm(pin: string | undefined, _by: string): Promise<AlarmState> {
    if (await this.hasPin()) {
      const row = await this.app.prisma.setting.findUnique({ where: { key: PIN_KEY } });
      const ok = !!pin && !!row && (await bcrypt.compare(pin, row.value));
      if (!ok) throw new AlarmPinError();
    }
    const wasActive = isActive(this.state);
    this.state = disarm(this.now());
    this.faultNotified.clear();
    await this.persist();
    // Al desarmar, apaga la sirena si estaba sonando (best-effort).
    if (wasActive) await this.setSiren(false);
    // El desarme lo audita la ruta (con actor+ip).
    return this.getState();
  }

  // ---- Disparo ----

  /** Un sensor/cámara vigilado se activó. Solo dispara si está armada. */
  private async onTrigger(by: string, opts: TriggerOptions = {}): Promise<void> {
    const config = await this.getConfig();
    const { state, justTriggered } = trigger(this.state, by, this.now(), config, opts);
    if (state === this.state) return; // sin cambio (no armada)
    this.state = state;
    await this.persist();
    if (justTriggered) await this.fireActions(by);
  }

  /** Ejecuta las acciones del disparo: sirena + luces + aviso urgente auditado. */
  private async fireActions(by: string): Promise<void> {
    const config = await this.getConfig();
    this.app.audit({ action: 'alarm.triggered', detail: by });
    this.app.log.warn(`[alarm] ¡ALARMA! disparada por ${by}`);
    // Sirena y luces **a la vez** (US-229 / AUD3-19): en serie, con 4 luces y el
    // bridge caído la sirena de una alarma disparada podía tardar 50 s en sonar.
    // La sirena va aparte del lote: es la acción que no puede esperar cola.
    await Promise.all([
      this.setSiren(true),
      settleWithLimit(config.lightDeviceIds, (id) =>
        withActionTimeout(() => this.iot.setState(id, { on: true })).catch((err: unknown) =>
          this.app.log.warn({ err }, `[alarm] no se pudo encender la luz ${id}`),
        ),
      ),
    ]);
  }

  private async setSiren(on: boolean): Promise<void> {
    const config = await this.getConfig();
    if (!config.sirenDeviceId) return;
    await withActionTimeout(() => this.iot.setState(config.sirenDeviceId!, { on })).catch((err) =>
      this.app.log.warn({ err }, '[alarm] no se pudo accionar la sirena'),
    );
  }

  // ---- Barrido: cuentas atrás + fail-safe ----

  async tick(nowMs: number = this.now()): Promise<void> {
    const { state, justTriggered } = advance(this.state, nowMs);
    if (state !== this.state) {
      this.state = state;
      await this.persist();
      if (justTriggered) await this.fireActions(state.triggeredBy ?? 'sensor');
    }
    // El barrido corre cada segundo (las cuentas atrás de entrada/salida lo
    // exigen), pero el fail-safe consulta el hardware IoT: a 1/s eran 60
    // `listDevices()` por minuto solo desde aquí (US-229 / AUD3-18). Un sensor
    // caído se detecta igual de bien con granularidad de 30 s.
    if (nowMs - this.lastFailSafeMs >= FAIL_SAFE_INTERVAL_MS) {
      this.lastFailSafeMs = nowMs;
      await this.failSafeCheck();
    }
  }

  /**
   * Fail-safe (US-188): estando la alarma activa, un sensor IoT vigilado que se
   * cae (no `reachable`) **no** se ignora — se avisa una vez (`alarm.sensor_fault`).
   *
   * US-245 añade el segundo frente: los **detectores de humo/CO** (`kind: 'smoke'`,
   * que incluye los de CO por la clasificación de US-244) se comprueban **siempre**,
   * armada o no y estén en la lista de vigilancia o no. Es el mismo invariante que
   * el aviso: un detector desconectado no avisa de nada, y esa es exactamente la
   * avería que hay que contar en voz alta. Ojo con el modo de fallo que se evita:
   * «no ha sonado» es indistinguible de «no hay humo» hasta que es tarde.
   */
  private async failSafeCheck(): Promise<void> {
    const activa = isActive(this.state);
    if (!activa) this.faultNotified.clear();
    const config = await this.getConfig();
    const vigilados = activa ? config.sensorDeviceIds : [];
    // La lista se pide igualmente para los detectores de humo: va por la vista
    // cacheada de US-229 (TTL 5 s + single-flight), compartida con los otros
    // barridos, así que no añade tráfico real contra el bridge o el broker.
    const devices = await this.iot.listDevices().catch(() => [] as IotDevice[]);
    const byId = new Map(devices.map((d) => [d.id, d]));

    for (const id of vigilados) {
      const dev = byId.get(id);
      const down = !dev || !dev.reachable;
      if (down && !this.faultNotified.has(id)) {
        this.faultNotified.add(id);
        this.app.audit({ action: 'alarm.sensor_fault', detail: dev?.name ?? id });
        this.app.log.warn(`[alarm] sensor caído estando armada: ${dev?.name ?? id}`);
      } else if (!down) {
        this.faultNotified.delete(id);
      }
    }

    for (const dev of devices) {
      if (dev.kind !== 'smoke') continue;
      if (!dev.reachable && !this.faultNotifiedVital.has(dev.id)) {
        this.faultNotifiedVital.add(dev.id);
        this.app.audit({ action: 'alarm.sensor_fault', detail: `${dev.name} (detector de humo/CO)` });
        this.app.log.warn(`[alarm] detector de humo/CO caído: ${dev.name}`);
      } else if (dev.reachable) {
        this.faultNotifiedVital.delete(dev.id);
      }
    }
  }

  // ---- Cableado del bus ----

  start(): void {
    if (this.loop) return;
    // Movimiento de cámara vigilada / sensor IoT vigilado / modo away (auto-armado).
    this.bus.subscribe((event) => {
      void this.onBusEvent(event).catch((err) =>
        this.app.log.warn({ err }, '[alarm] fallo procesando un evento del hogar'),
      );
    });
    this.loop = createTickLoop({
      intervalMs: this.opts.intervalMs ?? 1000,
      tick: () => this.tick(),
      onError: (err) => this.app.log.warn({ err }, '[alarm] el barrido falló; se omite este ciclo'),
      onSkip: () =>
        this.app.log.warn('[alarm] el barrido anterior sigue en curso; se salta este ciclo'),
    });
    this.loop.start();
  }

  /**
   * Aviso de riesgo vital (US-245): humo o CO **siempre** avisan, esté la alarma
   * armada o no y esté el detector en `sensorDeviceIds` o no.
   *
   * Va **antes** y **fuera** de la cadena de la alarma a propósito: aquélla es
   * antirrobo —dos puertas, «lo vigilo» y «estoy armada»— y las dos son
   * irrelevantes para un incendio. Este camino no toca la máquina de estados; el
   * disparo de la alarma, si además procede, lo decide la cadena de abajo.
   */
  private async avisoVital(event: HomeEvent): Promise<void> {
    const aviso = decideAvisoVital(event, this.ultimosAvisosVitales, this.now());
    if (!aviso) return;
    this.ultimosAvisosVitales.set(aviso.clave, this.now());
    const nombre = await this.nombreDeAparato(aviso.deviceId);
    const detalle = detalleDeAviso(aviso.metric, nombre);
    // La auditoría es la que dispara el aviso multicanal (push/email/Telegram)
    // según el catálogo de alertas: no hay un segundo camino de notificación.
    this.app.audit({ action: aviso.accion, detail: detalle });
    this.app.log.warn(`[alarm] ${detalle}`);
  }

  /** Nombre legible de un aparato IoT; su id si no se puede resolver. */
  private async nombreDeAparato(id: string): Promise<string> {
    const devices = await this.iot.listDevices().catch(() => [] as IotDevice[]);
    return devices.find((d) => d.id === id)?.name ?? id;
  }

  /** Procesa un evento del bus del hogar (US-167). Público para tests. */
  async onBusEvent(event: HomeEvent): Promise<void> {
    await this.avisoVital(event);
    const config = await this.getConfig();
    if (event.type === 'motion-detected' && config.cameraIds.includes(event.cameraId)) {
      await this.onTrigger(event.cameraName);
    } else if (
      event.type === 'sensor-reading' &&
      config.sensorDeviceIds.includes(event.deviceId) &&
      // ⚠️ US-244: la métrica manda, NO el número. Antes bastaba con que el valor
      // cruzara 1, así que un canal Shelly en la lista de sensores disparaba la
      // alarma al encender una lámpara (0 W → 5 W). Una medida no es un suceso:
      // solo `contact`/`occupancy`/`smoke`/`co` significan «ha pasado algo».
      isSecurityMetric(event.metric) &&
      event.value >= 1 &&
      (event.prevValue === null || event.prevValue < 1)
    ) {
      // Sensor de apertura/presencia/humo: activación (flanco de subida a ≥1).
      // El retardo de entrada es la gracia para entrar y teclear el PIN: ante humo
      // o CO no hay nada que desarmar, así que se dispara ya (US-245).
      await this.onTrigger(await this.nombreDeAparato(event.deviceId), {
        sinRetardoDeEntrada: isLifeSafetyMetric(event.metric),
      });
    } else if (event.type === 'mode-changed' && event.mode === 'away' && config.autoArmAway) {
      if (this.state.phase === 'disarmed') await this.armAlarm('away', 'modo away');
    }
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
  }
}

/** El PIN de desarme no coincide (o falta). */
export class AlarmPinError extends Error {
  readonly code = 'ALARM_BAD_PIN';
  constructor() {
    super('PIN de desarme incorrecto');
    this.name = 'AlarmPinError';
  }
}
