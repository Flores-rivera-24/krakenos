import type {
  AlarmConfig,
  AlarmMode,
  AlarmState,
  HomeEvent,
  IotManager,
  UpdateAlarmConfigRequest,
} from '@krakenos/types';
import bcrypt from 'bcrypt';
import type { FastifyInstance } from 'fastify';
import type { HomeEventBus } from '../../automations/event-bus.js';
import { withActionTimeout } from '../../iot/action-timeout.js';
import { advance, arm, disarm, disarmedState, isActive, trigger } from '../../alarm/state-machine.js';

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
  private state: AlarmState;
  private timer: NodeJS.Timeout | null = null;
  private readonly faultNotified = new Set<string>();

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

  getState(): AlarmState {
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
    return this.state;
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
    return this.state;
  }

  // ---- Disparo ----

  /** Un sensor/cámara vigilado se activó. Solo dispara si está armada. */
  private async onTrigger(by: string): Promise<void> {
    const config = await this.getConfig();
    const { state, justTriggered } = trigger(this.state, by, this.now(), config);
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
    await this.setSiren(true);
    for (const id of config.lightDeviceIds) {
      await withActionTimeout(() => this.iot.setState(id, { on: true })).catch((err) =>
        this.app.log.warn({ err }, `[alarm] no se pudo encender la luz ${id}`),
      );
    }
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
    await this.failSafeCheck();
  }

  /**
   * Fail-safe (US-188): estando la alarma activa, un sensor IoT vigilado que se
   * cae (no `reachable`) **no** se ignora — se avisa una vez (`alarm.sensor_fault`).
   */
  private async failSafeCheck(): Promise<void> {
    if (!isActive(this.state)) {
      this.faultNotified.clear();
      return;
    }
    const config = await this.getConfig();
    if (config.sensorDeviceIds.length === 0) return;
    const devices = await this.iot.listDevices().catch(() => []);
    const byId = new Map(devices.map((d) => [d.id, d]));
    for (const id of config.sensorDeviceIds) {
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
  }

  // ---- Cableado del bus ----

  private async tickCycle(): Promise<void> {
    try {
      await this.tick();
    } catch (err) {
      this.app.log.warn({ err }, '[alarm] el barrido falló; se omite este ciclo');
    }
  }

  start(): void {
    if (this.timer) return;
    // Movimiento de cámara vigilada / sensor IoT vigilado / modo away (auto-armado).
    this.bus.subscribe((event) => {
      void this.onBusEvent(event).catch((err) =>
        this.app.log.warn({ err }, '[alarm] fallo procesando un evento del hogar'),
      );
    });
    this.timer = setInterval(() => void this.tickCycle(), this.opts.intervalMs ?? 1000);
    this.timer.unref();
  }

  /** Procesa un evento del bus del hogar (US-167). Público para tests. */
  async onBusEvent(event: HomeEvent): Promise<void> {
    const config = await this.getConfig();
    if (event.type === 'motion-detected' && config.cameraIds.includes(event.cameraId)) {
      await this.onTrigger(event.cameraName);
    } else if (
      event.type === 'sensor-reading' &&
      config.sensorDeviceIds.includes(event.deviceId) &&
      event.value >= 1 &&
      (event.prevValue === null || event.prevValue < 1)
    ) {
      // Sensor de apertura/movimiento: activación (flanco de subida a ≥1).
      const dev = (await this.iot.listDevices().catch(() => [])).find((d) => d.id === event.deviceId);
      await this.onTrigger(dev?.name ?? event.deviceId);
    } else if (event.type === 'mode-changed' && event.mode === 'away' && config.autoArmAway) {
      if (this.state.phase === 'disarmed') await this.armAlarm('away', 'modo away');
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
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
