import type {
  AccessSchedule,
  CreateAccessScheduleRequest,
  HardwareDriver,
  UpdateAccessScheduleRequest,
} from '@krakenos/types';
import type { AccessSchedule as DbAccessSchedule } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { activeBlockedMacs } from './schedule-eval.js';
import { evaluateBlocked, groupSchedulesByMac, type BlockReason } from './blocked-eval.js';
import { planDeReafirmacion } from '../../access/reaffirm.js';
import { createTickLoop, type TickLoop } from '../../system/tick-loop.js';

/**
 * Vista publicable del bloqueo efectivo de un dispositivo (US-236). **Sin MAC ni
 * IP**: viaja a MQTT/HA, donde el nombre acaba además en el registro de entidades.
 */
export interface BlockedDeviceView {
  /** `Device.id` (cuid, no-PII). */
  id: string;
  /** `label ?? hostname ?? «Dispositivo xxxxxx»` — nunca la MAC. */
  name: string;
  blocked: boolean;
  reasons: BlockReason[];
}

/** Fila de DB → contrato público (los `days` van como JSON string, US-63). */
export function toSchedule(row: DbAccessSchedule): AccessSchedule {
  let days: number[] = [];
  try {
    days = JSON.parse(row.days) as number[];
  } catch {
    days = [];
  }
  return {
    id: row.id,
    name: row.name,
    mac: row.mac,
    enabled: row.enabled,
    days,
    startMinute: row.startMinute,
    endMinute: row.endMinute,
    personId: row.personId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Clave de `Setting` donde se persisten las MACs bloqueadas por horario/pausa (US-197). */
const MANAGED_BLOCKED_KEY = 'access.managedBlocked';

/**
 * Horarios de acceso / control parental (US-108). Hace dos cosas: CRUD de horarios
 * y un **barrido periódico** que aplica el bloqueo/desbloqueo por horario vía el
 * driver. El bloqueo efectivo de un dispositivo es `manual (Device.isBlocked) OR
 * horario activo`; el servicio solo toca el driver por su cuenta cuando un horario
 * empieza/termina, y **nunca** desbloquea un dispositivo bloqueado a mano.
 */
export class AccessScheduleService {
  private loop: TickLoop | null = null;
  /**
   * MACs que este servicio bloqueó por horario o pausa (para no pisar bloqueos
   * manuales). Se **persiste** en `Setting` y se recarga en `reconcile()` al
   * arrancar: sin eso, un reinicio dejaría el bloqueo aplicado en el driver sin
   * nadie que lo retire al terminar la ventana (US-197 / AUD-01).
   */
  private readonly managedBlocked = new Set<string>();
  /**
   * Última reafirmación correcta por MAC (ms). **En memoria a propósito**: tras un
   * reinicio del agente no consta que el router siga teniendo sus reglas, así que
   * empezar con el mapa vacío hace que todo se reafirme en los primeros barridos.
   * Persistirlo ahorraría unos comandos y reintroduciría justo el agujero.
   */
  private readonly reafirmadas = new Map<string, number>();

  /**
   * Reconciliación de los horarios **de persona** contra el parque real (US-240),
   * inyectada para no acoplar este servicio al de personas (mismo patrón que
   * `inventoryService.setScheduleGuard`). Corre **antes** de aplicar el barrido:
   * una fila que ya no corresponde a su dueño no debe cortar internet ni un ciclo
   * más.
   */
  private reconcilePeople: (() => Promise<void>) | null = null;

  constructor(
    private readonly app: FastifyInstance,
    private readonly driver: HardwareDriver,
  ) {}

  /** Inyecta el reconciliador de horarios de persona (US-240). */
  setPersonReconciler(fn: () => Promise<void>): void {
    this.reconcilePeople = fn;
  }

  // ---- CRUD ----

  async list(): Promise<AccessSchedule[]> {
    const rows = await this.app.prisma.accessSchedule.findMany({ orderBy: { createdAt: 'asc' } });
    return rows.map(toSchedule);
  }

  async listForMac(mac: string): Promise<AccessSchedule[]> {
    const rows = await this.app.prisma.accessSchedule.findMany({
      where: { mac },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toSchedule);
  }

  async create(body: CreateAccessScheduleRequest): Promise<AccessSchedule> {
    const row = await this.app.prisma.accessSchedule.create({
      data: {
        name: body.name,
        mac: body.mac,
        enabled: body.enabled ?? true,
        days: JSON.stringify([...new Set(body.days)].sort((a, b) => a - b)),
        startMinute: body.startMinute,
        endMinute: body.endMinute,
      },
    });
    return toSchedule(row);
  }

  async update(id: string, patch: UpdateAccessScheduleRequest): Promise<AccessSchedule | null> {
    const existing = await this.app.prisma.accessSchedule.findUnique({ where: { id } });
    if (!existing) return null;
    const row = await this.app.prisma.accessSchedule.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.days !== undefined
          ? { days: JSON.stringify([...new Set(patch.days)].sort((a, b) => a - b)) }
          : {}),
        ...(patch.startMinute !== undefined ? { startMinute: patch.startMinute } : {}),
        ...(patch.endMinute !== undefined ? { endMinute: patch.endMinute } : {}),
      },
    });
    return toSchedule(row);
  }

  async remove(id: string): Promise<boolean> {
    const existing = await this.app.prisma.accessSchedule.findUnique({ where: { id } });
    if (!existing) return false;
    await this.app.prisma.accessSchedule.delete({ where: { id } });
    return true;
  }

  /**
   * «¿Está bloqueado ahora y **por qué**?» para todos los dispositivos conocidos
   * (US-236). Resuelve N dispositivos en **2 consultas** y **cero llamadas al
   * driver** (el contrato `HardwareDriver` solo sabe *escribir* bloqueos, no
   * leerlos); la decisión la toma `evaluateBlocked`, que es puro.
   *
   * ⚠️ **La MAC no sale de aquí**: es PII y esta vista alimenta la publicación
   * MQTT (US-236). Se identifica por `Device.id` y se nombra por
   * `label ?? hostname`; un dispositivo sin nombre humano recibe uno genérico en
   * vez de su MAC.
   */
  async blockedViews(now: Date = new Date()): Promise<BlockedDeviceView[]> {
    const [devices, schedules] = await Promise.all([
      this.app.prisma.device.findMany({
        select: { id: true, mac: true, label: true, hostname: true, isBlocked: true, pausedUntil: true },
        orderBy: { mac: 'asc' },
      }),
      this.app.prisma.accessSchedule.findMany({ where: { enabled: true } }),
    ]);
    const byMac = groupSchedulesByMac(schedules.map(toSchedule));

    return devices.map((d) => {
      const state = evaluateBlocked({
        isBlocked: d.isBlocked,
        pausedUntil: d.pausedUntil,
        schedules: byMac.get(d.mac) ?? [],
        mac: d.mac,
        now,
      });
      return {
        id: d.id,
        name: d.label ?? d.hostname ?? `Dispositivo ${d.id.slice(-6)}`,
        blocked: state.blocked,
        reasons: state.reasons,
      };
    });
  }

  /**
   * ¿Lo mantienen bloqueado **horario o pausa**? Deliberadamente **ignora el
   * bloqueo manual**: su consumidor es el desbloqueo a mano, que ya conoce el
   * manual y pregunta «si lo desbloqueo, ¿algo más debería mantenerlo cortado?».
   * Para el bloqueo **efectivo** (las tres fuentes) usa `blockedViews`.
   */
  async isBlockedNow(mac: string, now: Date = new Date()): Promise<boolean> {
    const device = await this.app.prisma.device.findUnique({
      where: { mac },
      select: { pausedUntil: true },
    });
    if (device?.pausedUntil && device.pausedUntil > now) return true;
    const rows = await this.app.prisma.accessSchedule.findMany({ where: { mac, enabled: true } });
    return activeBlockedMacs(rows.map(toSchedule), now).has(mac);
  }

  // ---- Persistencia del estado gestionado (US-197) ----

  private async persistManaged(): Promise<void> {
    const value = JSON.stringify([...this.managedBlocked].sort());
    try {
      await this.app.prisma.setting.upsert({
        where: { key: MANAGED_BLOCKED_KEY },
        update: { value },
        create: { key: MANAGED_BLOCKED_KEY, value },
      });
    } catch (err) {
      this.app.log.warn({ err }, '[access] no se pudo persistir el estado de bloqueo gestionado');
    }
  }

  private async loadManaged(): Promise<void> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: MANAGED_BLOCKED_KEY } });
    if (!row) return;
    try {
      const macs = JSON.parse(row.value) as string[];
      for (const mac of macs) if (typeof mac === 'string') this.managedBlocked.add(mac);
    } catch (err) {
      this.app.log.warn({ err }, '[access] estado de bloqueo gestionado corrupto; se ignora');
    }
  }

  /**
   * Reconcilia driver↔estado al arrancar: recarga las MACs que quedaron bloqueadas
   * por horario/pausa antes del reinicio y aplica un barrido inmediato, que
   * desbloquea (idempotente) lo que ya no debe estar bloqueado.
   */
  async reconcile(now: Date = new Date()): Promise<void> {
    await this.loadManaged();
    await this.tick(now);
  }

  // ---- Pausa de internet de un toque (US-111) ----

  /**
   * Pausa el internet de un dispositivo `minutes` minutos.
   *
   * `applied` dice si el **driver** aceptó el corte ya (US-240). No cambia la
   * semántica de reintento —si falla, la MAC queda activa pero no gestionada y el
   * barrido lo reintenta cada minuto—, pero sin exponerlo, una acción sobre los
   * seis aparatos de una persona no puede reportar el parcial real y acabaría
   * prometiendo un corte que aún no existe.
   */
  async pause(mac: string, minutes: number): Promise<{ pausedUntil: Date; applied: boolean }> {
    const pausedUntil = new Date(Date.now() + minutes * 60_000);
    await this.app.prisma.device.updateMany({ where: { mac }, data: { pausedUntil } });
    // Solo se marca como gestionado tras el éxito del driver: si falla, la MAC
    // queda "activa pero no gestionada" y el barrido reintenta el bloqueo cada
    // minuto mientras dure la pausa (US-200 / AUD-04).
    try {
      await this.driver.blockDevice(mac);
      this.managedBlocked.add(mac);
      await this.persistManaged();
      return { pausedUntil, applied: true };
    } catch (err) {
      this.app.log.error({ err, mac }, '[access] no se pudo pausar el dispositivo; se reintenta');
      return { pausedUntil, applied: false };
    }
  }

  /**
   * Reanuda el internet de un dispositivo. Si un horario o el bloqueo manual
   * siguen activos, permanece bloqueado (y eso **no** es un fallo: `applied`
   * queda en `true` porque no había nada que pedirle al driver).
   */
  async resume(mac: string): Promise<{ applied: boolean }> {
    await this.app.prisma.device.updateMany({ where: { mac }, data: { pausedUntil: null } });
    const device = await this.app.prisma.device.findUnique({ where: { mac } });
    const manual = device?.isBlocked ?? false;
    // Con la pausa ya quitada, `isBlockedNow` refleja solo los horarios.
    const keepBlocked = manual || (await this.isBlockedNow(mac));
    if (!keepBlocked) {
      // Igual que en `pause`: si el driver falla, la MAC sigue gestionada y el
      // barrido reintenta el desbloqueo en el siguiente tick (US-200 / AUD-04).
      try {
        await this.driver.unblockDevice(mac);
        this.managedBlocked.delete(mac);
        await this.persistManaged();
      } catch (err) {
        this.app.log.error({ err, mac }, '[access] no se pudo reanudar el dispositivo; se reintenta');
        return { applied: false };
      }
    }
    return { applied: true };
  }

  // ---- Enforcement ----

  /** Aplica el estado de bloqueo por horario en el instante `now`. */
  async tick(now: Date = new Date()): Promise<void> {
    // US-240: primero se ajustan los horarios de persona al inventario vigente; si
    // no, un aparato que cambió de dueño arrastraría el corte del anterior. Un
    // fallo aquí no puede tumbar el enforcement, que es lo importante del barrido.
    if (this.reconcilePeople) {
      try {
        await this.reconcilePeople();
      } catch (err) {
        this.app.log.error({ err }, '[access] la reconciliación de horarios de persona falló');
      }
    }
    const rows = await this.app.prisma.accessSchedule.findMany({ where: { enabled: true } });
    const active = activeBlockedMacs(rows.map(toSchedule), now);
    // La pausa de internet (US-111) cuenta como bloqueo activo hasta que expira; el
    // barrido la desbloquea automáticamente cuando `pausedUntil` queda en el pasado.
    const paused = await this.app.prisma.device.findMany({
      where: { pausedUntil: { gt: now } },
      select: { mac: true },
    });
    for (const d of paused) active.add(d.mac);
    // Considera las MAC activas ahora + las que nosotros dejamos bloqueadas.
    const macs = new Set<string>([...active, ...this.managedBlocked]);
    let changed = false;

    for (const mac of macs) {
      const shouldBlock = active.has(mac);
      const managedByUs = this.managedBlocked.has(mac);
      if (shouldBlock === managedByUs) continue; // sin cambio

      const device = await this.app.prisma.device.findUnique({ where: { mac } });
      const manual = device?.isBlocked ?? false;
      try {
        if (shouldBlock) {
          if (!manual) await this.driver.blockDevice(mac);
          this.managedBlocked.add(mac);
          changed = true;
          this.app.audit({ action: 'access.schedule_block', detail: mac });
        } else {
          // Fin de la ventana: solo desbloquea si NO está bloqueado a mano.
          if (!manual) await this.driver.unblockDevice(mac);
          this.managedBlocked.delete(mac);
          changed = true;
          this.app.audit({ action: 'access.schedule_unblock', detail: mac });
        }
      } catch (err) {
        this.app.log.error({ err, mac }, '[access] fallo al aplicar el horario; se reintenta');
      }
    }
    if (changed) await this.persistManaged();
    await this.reafirmarBloqueos(now);
  }

  /**
   * Reafirma periódicamente contra el driver lo que **debe** estar bloqueado
   * (US-255).
   *
   * El bucle de arriba solo llama al driver cuando el estado deseado **cambia**, y
   * las reglas no viven aquí: viven en el router. Un reinicio del router, un
   * `fw4 restart` o una restauración de su config se las llevan, y sin esto
   * KrakenOS no se entera nunca — el panel sigue diciendo «Bloqueado» con el
   * aparato navegando. Es el único fallo de esta clase que **no** se manifiesta
   * como un error.
   *
   * Cubre las **tres** fuentes (manual ∪ horario ∪ pausa) y no solo las nuestras:
   * el reinicio se lleva también las reglas del bloqueo manual, así que reafirmar
   * solo lo gestionado dejaría el mismo agujero un poco más pequeño.
   *
   * Solo reafirma **bloqueos**, nunca desbloqueos: lo que un reinicio del router
   * produce es «debería estar cortado y no lo está», y el caso contrario ya lo
   * cierra el bucle de arriba. Reafirmar los dos sentidos doblaría el tráfico SSH
   * para cubrir un fallo que no ocurre.
   */
  private async reafirmarBloqueos(now: Date): Promise<void> {
    const manuales = await this.app.prisma.device.findMany({
      where: { isBlocked: true },
      select: { mac: true },
    });
    const deseadas = new Set<string>([...this.managedBlocked, ...manuales.map((d) => d.mac)]);
    const plan = planDeReafirmacion(deseadas, this.reafirmadas, now.getTime());

    for (const mac of plan.olvidar) this.reafirmadas.delete(mac);
    for (const mac of plan.reafirmar) {
      try {
        await this.driver.blockDevice(mac);
        // La marca avanza SOLO tras el éxito: con el router caído, la MAC sigue
        // vencida y se reintenta en el barrido siguiente en vez de darse por
        // reafirmada durante todo un intervalo.
        this.reafirmadas.set(mac, now.getTime());
      } catch (err) {
        // No se audita ni se alerta: reafirmar es rutina y el fallo puntual ya lo
        // reporta el log. Lo que importa es que la marca no avance.
        this.app.log.warn({ err, mac }, '[access] no se pudo reafirmar el bloqueo; se reintenta');
      }
    }
  }

  /** Barrido sin propagar errores (para el timer). */
  start(intervalMs = 60_000): void {
    if (this.loop) return;
    // El primer barrido reconcilia con lo persistido antes del reinicio (US-197).
    void this.reconcile().catch((err: unknown) => {
      this.app.log.error({ err }, '[access] la reconciliación al arrancar falló; se omite');
    });
    this.loop = createTickLoop({
      intervalMs,
      tick: () => this.tick(),
      onError: (err) =>
        this.app.log.error({ err }, '[access] el barrido de horarios falló; se omite'),
      onSkip: () =>
        this.app.log.warn('[access] el barrido anterior sigue en curso; se salta este ciclo'),
    });
    this.loop.start();
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
  }
}
