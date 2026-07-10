import type {
  CameraManager,
  CameraMotionConfig,
  MotionArming,
  MotionConfig,
  MotionEvent,
  MotionSensitivity,
  UpdateMotionConfigRequest,
} from '@krakenos/types';
import { MOTION_SENSITIVITIES } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { detectMotion, isArmed, sensitivityToThresholds } from '../../cameras/motion.js';
import type { HomeEventBus } from '../../automations/event-bus.js';

/** Clave del `Setting` con el mapa `{ [cameraId]: MotionConfig }` (US-186). */
const MOTION_SETTING_KEY = 'cameras.motion';

/** Config por defecto: **desactivada** (el usuario la arma por cámara). */
export const DEFAULT_MOTION_CONFIG: MotionConfig = {
  enabled: false,
  sensitivity: 'medium',
  cooldownSec: 60,
  arming: { mode: 'always' },
};

/** Acota un número al rango `[min, max]` (o el fallback si no es número). */
function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** Normaliza una ventana de armado (defensivo ante datos corruptos). */
function normalizeArming(raw: unknown): MotionArming {
  const mode = (raw as { mode?: unknown })?.mode;
  if (mode === 'always' || mode === 'never') return { mode };
  if (mode === 'schedule') {
    const windows = Array.isArray((raw as { windows?: unknown }).windows)
      ? ((raw as { windows: unknown[] }).windows)
          .map((w) => {
            const from = clampInt((w as { fromMinute?: unknown }).fromMinute, 0, 1439, -1);
            const to = clampInt((w as { toMinute?: unknown }).toMinute, 0, 1439, -1);
            if (from < 0 || to < 0) return null;
            const days = Array.isArray((w as { days?: unknown }).days)
              ? ((w as { days: unknown[] }).days
                  .map((d) => clampInt(d, 0, 6, -1))
                  .filter((d) => d >= 0))
              : undefined;
            return days ? { fromMinute: from, toMinute: to, days } : { fromMinute: from, toMinute: to };
          })
          .filter((w): w is NonNullable<typeof w> => w !== null)
      : [];
    return { mode: 'schedule', windows };
  }
  return DEFAULT_MOTION_CONFIG.arming;
}

/**
 * Normaliza una config cruda (de la DB o de la API) a una `MotionConfig` válida.
 * **Puro** y defensivo (patrón US-63): un valor corrupto cae al por defecto sin
 * romper. Exportado para tests.
 */
export function normalizeMotionConfig(raw: unknown, base: MotionConfig = DEFAULT_MOTION_CONFIG): MotionConfig {
  const r = (raw ?? {}) as Record<string, unknown>;
  const sensitivity = (MOTION_SENSITIVITIES as readonly string[]).includes(r.sensitivity as string)
    ? (r.sensitivity as MotionSensitivity)
    : base.sensitivity;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : base.enabled,
    sensitivity,
    cooldownSec: clampInt(r.cooldownSec, 5, 3600, base.cooldownSec),
    arming: 'arming' in r ? normalizeArming(r.arming) : base.arming,
  };
}

/**
 * Detección de movimiento por cámara (US-186). Sondea las cámaras **armadas** y
 * habilitadas, compara la huella de gris actual con la anterior (detector puro
 * `motion.ts`) y, al detectar movimiento respetando el cooldown, dispara:
 *   - guarda un `MotionEvent` con snapshot (línea de tiempo US-187),
 *   - publica `motion-detected` al bus (disparador de automatización US-167),
 *   - audita `camera.motion` → aviso multicanal (US-180),
 *   - envía la **foto** por Telegram si está configurado.
 *
 * La config vive en `Setting` (`cameras.motion`, parseo defensivo); el estado por
 * cámara (fotograma previo, último disparo) es en memoria.
 */
export class MotionService {
  private timer: NodeJS.Timeout | null = null;
  private readonly prevFrames = new Map<string, Uint8Array>();
  private readonly lastFiredMs = new Map<string, number>();
  private readonly events: MotionEvent[] = [];

  constructor(
    private readonly app: FastifyInstance,
    private readonly cameras: CameraManager,
    private readonly bus: HomeEventBus,
    private readonly opts: { intervalMs?: number; now?: () => number; maxEvents?: number } = {},
  ) {}

  private get intervalMs(): number {
    return this.opts.intervalMs ?? 5_000;
  }
  private get now(): () => number {
    return this.opts.now ?? Date.now;
  }
  private get maxEvents(): number {
    return this.opts.maxEvents ?? 50;
  }

  // ---- Config (Setting `cameras.motion`) ----

  private async readAll(): Promise<Record<string, MotionConfig>> {
    const row = await this.app.prisma.setting.findUnique({ where: { key: MOTION_SETTING_KEY } });
    if (!row) return {};
    try {
      const parsed = JSON.parse(row.value) as Record<string, unknown>;
      const out: Record<string, MotionConfig> = {};
      for (const [id, cfg] of Object.entries(parsed)) out[id] = normalizeMotionConfig(cfg);
      return out;
    } catch {
      this.app.log.warn('[motion] ajuste cameras.motion corrupto; se ignora');
      return {};
    }
  }

  /** Config efectiva de una cámara (con defaults). */
  async getConfig(cameraId: string): Promise<CameraMotionConfig> {
    const all = await this.readAll();
    return { cameraId, ...(all[cameraId] ?? DEFAULT_MOTION_CONFIG) };
  }

  /** Aplica cambios parciales a la config de una cámara y la persiste. */
  async setConfig(cameraId: string, patch: UpdateMotionConfigRequest): Promise<CameraMotionConfig> {
    const all = await this.readAll();
    const current = all[cameraId] ?? DEFAULT_MOTION_CONFIG;
    const next = normalizeMotionConfig({ ...current, ...patch }, current);
    all[cameraId] = next;
    await this.app.prisma.setting.upsert({
      where: { key: MOTION_SETTING_KEY },
      create: { key: MOTION_SETTING_KEY, value: JSON.stringify(all) },
      update: { value: JSON.stringify(all) },
    });
    // Un cambio de config reinicia el estado de esa cámara (evita falsos disparos).
    this.prevFrames.delete(cameraId);
    return { cameraId, ...next };
  }

  /** Eventos de movimiento recientes (más nuevo primero), opcionalmente por cámara. */
  recentEvents(cameraId?: string): MotionEvent[] {
    return cameraId ? this.events.filter((e) => e.cameraId === cameraId) : [...this.events];
  }

  // ---- Barrido ----

  /** Un barrido: evalúa cada cámara armada+habilitada. `now` inyectable en tests. */
  async tick(now: Date = new Date()): Promise<void> {
    const configs = await this.readAll();
    const enabledIds = Object.entries(configs).filter(([, c]) => c.enabled).map(([id]) => id);
    if (enabledIds.length === 0) return;

    const cameras = await this.cameras.listCameras();
    const byId = new Map(cameras.map((c) => [c.id, c]));

    for (const id of enabledIds) {
      const camera = byId.get(id);
      const cfg = configs[id]!;
      if (!camera || !camera.online) continue;
      if (!isArmed(cfg.arming, now)) continue;

      const frame = await this.cameras.getMotionFrame(id);
      if (!frame) continue;
      const prev = this.prevFrames.get(id) ?? null;
      this.prevFrames.set(id, frame);

      const { motion } = detectMotion(prev, frame, sensitivityToThresholds(cfg.sensitivity));
      if (!motion) continue;

      const last = this.lastFiredMs.get(id) ?? Number.NEGATIVE_INFINITY;
      if (this.now() - last < cfg.cooldownSec * 1000) continue; // dentro del cooldown
      this.lastFiredMs.set(id, this.now());
      await this.fire(camera.id, camera.name, now);
    }
  }

  /** Registra el evento, publica al bus, audita y envía la foto por Telegram. */
  private async fire(cameraId: string, cameraName: string, now: Date): Promise<void> {
    const snapshot = await this.cameras.getSnapshot(cameraId).catch(() => null);
    const image = snapshot?.image ?? null;

    const event: MotionEvent = {
      cameraId,
      cameraName,
      detectedAt: now.toISOString(),
      snapshot: image,
    };
    this.events.unshift(event);
    if (this.events.length > this.maxEvents) this.events.length = this.maxEvents;

    this.bus.publish({ type: 'motion-detected', cameraId, cameraName });
    // Aviso de texto multicanal (US-180) + registro/auditoría/digest.
    this.app.audit({ action: 'camera.motion', detail: cameraName });
    // La foto va aparte por Telegram (el canal donde una imagen adjunta es natural).
    if (image) this.app.telegram?.sendPhotoForAudit('camera.motion', `📷 ${cameraName}`, image);
    this.app.log.info(`[motion] movimiento en ${cameraName}`);
  }

  private async tickCycle(): Promise<void> {
    try {
      await this.tick();
    } catch (err) {
      this.app.log.warn({ err }, '[motion] el barrido de movimiento falló; se omite este ciclo');
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tickCycle(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
