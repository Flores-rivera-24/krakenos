import type {
  HomeEvent,
  HomeMode,
  HomeModeSource,
  PersonPresence,
  PresenceEvent,
  PresenceState,
  UserRole,
} from '@krakenos/types';
import { HOME_MODES } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { SETTING_BOUNDS, clampToBound } from '../../config/settings-bounds.js';
import { isWithinWindow, parseMaintenanceWindow } from '../../system/maintenance-window.js';
import type { HomeEventBus } from '../../automations/event-bus.js';

/** Clave interna de `Setting` con el modo del hogar (no editable por la allowlist). */
const MODE_SETTING_KEY = 'presence.mode';

/** Ventana de gracia por defecto si el ajuste falta/es inválido (minutos). */
const DEFAULT_GRACE_MIN = 10;

/** Barridos consecutivos offline por defecto (US-220), además de la gracia. */
const DEFAULT_LEAVE_SWEEPS = 2;

/** Una salida pendiente de confirmar: cuándo empezó y cuántos barridos lleva. */
interface PendingLeave {
  /** Instante en que el dueño se quedó sin señal. */
  since: Date;
  /** Barridos consecutivos que han re-confirmado el offline (histéresis US-220). */
  sweeps: number;
}

/** Quién pregunta por el estado (la presencia ajena se acota por rol). */
export interface PresenceRequester {
  sub: string;
  role: UserRole;
}

interface ModeState {
  mode: HomeMode;
  source: HomeModeSource;
  changedAt: string | null;
}

const DEFAULT_MODE: ModeState = { mode: 'home', source: 'manual', changedAt: null };

function isHomeMode(value: unknown): value is HomeMode {
  return typeof value === 'string' && (HOME_MODES as readonly string[]).includes(value);
}

/**
 * Modos del hogar + presencia por WiFi (US-169). La presencia se deriva de los
 * eventos `device-online/offline` del bus (US-167) sobre los dispositivos con
 * dueño (`Device.ownerId`, US-179):
 *
 * - **Llegada**: el primer dispositivo del dueño que pasa a online marca la
 *   llegada al instante (y cancela cualquier salida pendiente).
 * - **Salida**: los móviles duermen el WiFi, así que quedarse sin dispositivos
 *   online solo arma una salida **pendiente**; el barrido por minuto la confirma
 *   cuando pasa la ventana de gracia (`presenceGraceMin`) sin volver la señal.
 *
 * El modo (`home`/`away`/`night`) es un estado global observable persistido en
 * `Setting` (`presence.mode`): manual vía API (capacidad `home.control`) o
 * derivado — la última persona en salir pone `away`; una llegada estando `away`
 * pone `home` (los modos manuales `night`/`home` no se pisan al llegar alguien
 * más). Cada cambio publica `mode-changed` en el bus (trigger de US-167) y
 * `presence:updated` por socket (solo el modo: la lista de personas es sensible
 * y se re-consulta por API, que acota por rol).
 */
export class PresenceService {
  private timer: NodeJS.Timeout | null = null;
  /** Salidas pendientes de confirmar: userId → estado de la salida (US-220). */
  private readonly pendingLeave = new Map<string, PendingLeave>();
  /** Última presencia conocida por persona (caché; la verdad histórica está en la DB). */
  private readonly homeState = new Map<string, boolean>();

  constructor(
    private readonly app: FastifyInstance,
    private readonly bus: HomeEventBus,
  ) {
    bus.subscribe((event) => this.onEvent(event));
  }

  // ---- Estado observable ----

  /** Modo actual desde `Setting`, con parseo defensivo (patrón US-63). */
  private async modeState(): Promise<ModeState> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: MODE_SETTING_KEY } });
    if (!row) return DEFAULT_MODE;
    try {
      const parsed = JSON.parse(row.value) as Partial<ModeState>;
      if (!isHomeMode(parsed.mode)) throw new Error('modo desconocido');
      return {
        mode: parsed.mode,
        source: parsed.source === 'presence' ? 'presence' : 'manual',
        changedAt: typeof parsed.changedAt === 'string' ? parsed.changedAt : null,
      };
    } catch {
      this.app.log.warn('[presence] ajuste presence.mode corrupto; se asume el modo por defecto');
      return DEFAULT_MODE;
    }
  }

  /** Ventana de gracia en minutos, acotada (defensa en profundidad, US-75). */
  private async graceMinutes(): Promise<number> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: 'presenceGraceMin' } });
    const n = Number(row?.value);
    return clampToBound(n, SETTING_BOUNDS.presenceGraceMin) ?? DEFAULT_GRACE_MIN;
  }

  /** Barridos consecutivos offline exigidos para confirmar la salida (US-220). */
  private async leaveSweeps(): Promise<number> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: 'presenceLeaveSweeps' } });
    const n = Number(row?.value);
    return clampToBound(n, SETTING_BOUNDS.presenceLeaveSweeps) ?? DEFAULT_LEAVE_SWEEPS;
  }

  /**
   * ¿Estamos en la ventana de supresión nocturna (US-220)? Dentro de ella, una
   * desaparición WiFi no confirma "salió" (el móvil duerme el WiFi de madrugada).
   */
  private async isNightSuppressed(now: Date): Promise<boolean> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: 'presenceNightSuppress' } });
    const window = parseMaintenanceWindow(row?.value);
    if (!window) return false; // sin franja configurada → nunca suprime
    return isWithinWindow(window, now);
  }

  /**
   * Estado del hogar para quien pregunta: el modo es global; `people` se acota
   * por rol (admin ve a todas las personas con dispositivos; el resto solo a sí).
   */
  /**
   * Modo del hogar SOLO (sin la lista de personas). Para superficies que no deben
   * ver quién está (US-169: la interop MQTT publica el modo, nunca personas).
   */
  async getMode(): Promise<HomeMode> {
    return (await this.modeState()).mode;
  }

  async getState(requester: PresenceRequester): Promise<PresenceState> {
    const mode = await this.modeState();
    const users = await this.app.prisma.user.findMany({
      where:
        requester.role === 'admin' ? { devices: { some: {} } } : { id: requester.sub },
      orderBy: { displayName: 'asc' },
      select: {
        id: true,
        displayName: true,
        devices: { select: { online: true } },
        presenceEvents: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    const people: PersonPresence[] = users.map((u) => {
      const last = u.presenceEvents[0];
      return {
        userId: u.id,
        displayName: u.displayName,
        home: this.isHome(u.id, u.devices.some((d) => d.online)),
        since: last ? last.createdAt.toISOString() : null,
        deviceCount: u.devices.length,
        // `stale` si se le mantiene en casa pero su WiFi dejó de responder (US-220).
        signal: this.pendingLeave.has(u.id) ? 'stale' : 'fresh',
      };
    });
    return {
      mode: mode.mode,
      modeSource: mode.source,
      modeChangedAt: mode.changedAt,
      people,
    };
  }

  /** Presencia efectiva: caché (mantiene "en casa" durante la gracia) o señal actual. */
  private isHome(userId: string, anyDeviceOnline: boolean): boolean {
    return this.homeState.get(userId) ?? anyDeviceOnline;
  }

  /** Timeline de llegadas/salidas, acotado por rol (igual que `people`). */
  async timeline(requester: PresenceRequester, limit = 50): Promise<PresenceEvent[]> {
    const rows = await this.app.prisma.presenceEvent.findMany({
      where: requester.role === 'admin' ? {} : { userId: requester.sub },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { displayName: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      displayName: row.user.displayName,
      kind: row.kind === 'left' ? 'left' : 'arrived',
      at: row.createdAt.toISOString(),
    }));
  }

  // ---- Modo ----

  /**
   * Cambia el modo del hogar. Persiste, publica `mode-changed` en el bus (con
   * `origin` para que una futura acción de automatización no se re-dispare a sí
   * misma) y emite `presence:updated` por socket. Idempotente si el modo no cambia.
   */
  async setMode(mode: HomeMode, source: HomeModeSource, now: Date = new Date()): Promise<void> {
    const current = await this.modeState();
    if (current.mode === mode) return;
    const next: ModeState = { mode, source, changedAt: now.toISOString() };
    await this.app.prisma.setting.upsert({
      where: { key: MODE_SETTING_KEY },
      create: { key: MODE_SETTING_KEY, value: JSON.stringify(next) },
      update: { value: JSON.stringify(next) },
    });
    this.bus.publish({ type: 'mode-changed', mode, prevMode: current.mode, origin: 'presence' });
    this.emitUpdated(mode, source);
  }

  private emitUpdated(mode: HomeMode, modeSource: HomeModeSource): void {
    this.app.io.emit('presence:updated', { mode, modeSource });
  }

  // ---- Derivación de presencia ----

  /** Maneja un evento del bus (solo interesan las transiciones de inventario). */
  async onEvent(event: HomeEvent, now: Date = new Date()): Promise<void> {
    if (event.type !== 'device-online' && event.type !== 'device-offline') return;
    try {
      const device = await this.app.prisma.device.findUnique({
        where: { mac: event.mac },
        select: { ownerId: true },
      });
      const ownerId = device?.ownerId;
      if (!ownerId) return;

      if (event.type === 'device-online') {
        // Volvió la señal: cualquier salida pendiente se cancela sin registrar nada.
        this.pendingLeave.delete(ownerId);
        if (this.homeState.get(ownerId) === true) return;
        await this.markArrived(ownerId, now);
      } else {
        if (this.homeState.get(ownerId) === false) return;
        const stillOnline = await this.app.prisma.device.count({
          where: { ownerId, online: true },
        });
        if (stillOnline > 0) return;
        // Sin señal: no se marca la salida aún (los móviles duermen el WiFi);
        // el barrido la confirmará pasada la gracia + la histéresis (US-220).
        if (!this.pendingLeave.has(ownerId)) this.pendingLeave.set(ownerId, { since: now, sweeps: 0 });
      }
    } catch (err) {
      this.app.log.error({ err, event: event.type }, '[presence] fallo procesando el evento');
    }
  }

  private async markArrived(userId: string, now: Date): Promise<void> {
    const user = await this.app.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    this.homeState.set(userId, true);
    await this.app.prisma.presenceEvent.create({ data: { userId, kind: 'arrived' } });
    this.bus.publish({
      type: 'person-arrived',
      userId,
      name: user.displayName,
      origin: 'presence',
    });
    // Derivación del modo: una llegada solo saca al hogar de `away` (un `night`
    // manual no se pisa porque llegue alguien más tarde).
    const current = await this.modeState();
    if (current.mode === 'away') {
      await this.setMode('home', 'presence', now);
    } else {
      this.emitUpdated(current.mode, current.source);
    }
  }

  private async markLeft(userId: string, now: Date): Promise<void> {
    const user = await this.app.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return;
    this.homeState.set(userId, false);
    await this.app.prisma.presenceEvent.create({ data: { userId, kind: 'left' } });
    this.bus.publish({ type: 'person-left', userId, name: user.displayName, origin: 'presence' });
    // Última persona en salir → la casa queda vacía → `away` (desde cualquier modo).
    const anyoneOnline = await this.app.prisma.device.count({
      where: { ownerId: { not: null }, online: true },
    });
    const current = await this.modeState();
    if (anyoneOnline === 0 && this.pendingLeave.size === 0 && current.mode !== 'away') {
      await this.setMode('away', 'presence', now);
    } else {
      this.emitUpdated(current.mode, current.source);
    }
  }

  /**
   * Confirma las salidas pendientes que ya pasaron la gracia **y** acumulan N
   * barridos consecutivos offline (histéresis US-220), salvo dentro de la ventana
   * de supresión nocturna. Un dispositivo que vuelve en cualquier barrido cancela
   * la salida (rompe la racha) → la llegada la re-arma el propio evento del bus.
   */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.pendingLeave.size === 0) return;
    const graceMs = (await this.graceMinutes()) * 60_000;
    const requiredSweeps = await this.leaveSweeps();
    const suppressed = await this.isNightSuppressed(now);
    for (const [userId, pending] of [...this.pendingLeave]) {
      if (now.getTime() - pending.since.getTime() < graceMs) continue;

      // Re-verifica contra la DB: si algún dispositivo volvió sin pasar por el
      // bus (p. ej. reconciliación), no hay salida y se rompe la racha.
      const stillOnline = await this.app.prisma.device.count({
        where: { ownerId: userId, online: true },
      });
      if (stillOnline > 0) {
        this.pendingLeave.delete(userId);
        this.homeState.set(userId, true);
        continue;
      }

      // Supresión nocturna: dentro de la franja, una desaparición WiFi no confirma
      // la salida (el móvil duerme el WiFi de madrugada). Se mantiene pendiente.
      if (suppressed) continue;

      // Histéresis: exige N barridos consecutivos offline además de la gracia.
      const sweeps = pending.sweeps + 1;
      if (sweeps < requiredSweeps) {
        this.pendingLeave.set(userId, { since: pending.since, sweeps });
        continue;
      }
      this.pendingLeave.delete(userId);
      await this.markLeft(userId, now);
    }
  }

  /**
   * Reconciliación al arrancar (patrón US-197): hidrata la caché desde la DB y,
   * si el último evento registrado contradice la señal actual (la persona
   * llegó/salió mientras el agente no corría), corrige el **timeline** sin
   * publicar en el bus ni tocar el modo — al arrancar no se disparan
   * automatizaciones atrasadas (mismo principio que `prevTick`, US-168).
   */
  async reconcile(): Promise<void> {
    const users = await this.app.prisma.user.findMany({
      where: { devices: { some: {} } },
      select: {
        id: true,
        devices: { select: { online: true } },
        presenceEvents: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    for (const u of users) {
      const online = u.devices.some((d) => d.online);
      const last = u.presenceEvents[0];
      const recorded = last ? last.kind === 'arrived' : null;
      if (recorded !== null && recorded !== online) {
        await this.app.prisma.presenceEvent.create({
          data: { userId: u.id, kind: online ? 'arrived' : 'left' },
        });
        this.app.log.info(
          { userId: u.id, online },
          '[presence] timeline reconciliado tras el arranque',
        );
      }
      this.homeState.set(u.id, online);
    }
  }

  // ---- Ciclo ----

  private async tickCycle(): Promise<void> {
    try {
      await this.tick();
    } catch (err) {
      this.app.log.error({ err }, '[presence] el barrido falló; se omite este ciclo');
    }
  }

  start(intervalMs = 60_000): void {
    if (this.timer) return;
    void this.reconcile().catch((err) =>
      this.app.log.error({ err }, '[presence] la reconciliación inicial falló'),
    );
    this.timer = setInterval(() => void this.tickCycle(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
