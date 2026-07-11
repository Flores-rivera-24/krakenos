import type { AlertRule, UpdateAlertRuleRequest } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';

/**
 * Catálogo FIJO de eventos alertables (US-112): los eventos de seguridad para los
 * que existe contenido de notificación. El usuario solo decide, por evento, si
 * push y/o email — no puede inventar eventos sin contenido.
 */
export const ALERT_EVENTS: { event: string; label: string }[] = [
  { event: 'auth.login_failed', label: 'Login fallido' },
  { event: 'auth.login_locked', label: 'Cuenta bloqueada' },
  { event: 'auth.refresh_reuse', label: 'Posible robo de sesión' },
  { event: 'device.block', label: 'Dispositivo bloqueado' },
  { event: 'inventory.unknown_device', label: 'Dispositivo desconocido' },
  { event: 'energy.threshold', label: 'Consumo eléctrico anómalo' },
  { event: 'camera.motion', label: 'Movimiento detectado' },
  { event: 'alarm.triggered', label: '¡Alarma disparada!' },
  { event: 'alarm.sensor_fault', label: 'Sensor de alarma caído' },
];

const LABEL_BY_EVENT = new Map(ALERT_EVENTS.map((e) => [e.event, e.label]));

/** Canales por defecto de un evento del catálogo: push sí, email/Telegram no. */
const DEFAULT_CHANNELS = { push: true, email: false, telegram: false };

/**
 * Fuente de verdad de qué eventos alertan y por qué canal. Cachea las reglas en
 * memoria (una lectura por cambio, no por evento) para que `push`/`mailer` decidan
 * sin tocar la DB en cada acción auditada.
 */
export class AlertConfigService {
  private cache = new Map<string, { push: boolean; email: boolean; telegram: boolean }>();

  constructor(private readonly app: FastifyInstance) {}

  /** Crea las filas por defecto que falten y carga la caché. Se llama al arrancar. */
  async ensureDefaults(): Promise<void> {
    for (const { event } of ALERT_EVENTS) {
      await this.app.prisma.alertRule.upsert({ where: { event }, create: { event }, update: {} });
    }
    await this.reload();
  }

  async reload(): Promise<void> {
    const rows = await this.app.prisma.alertRule.findMany();
    this.cache = new Map(
      rows.map((r) => [r.event, { push: r.push, email: r.email, telegram: r.telegram }]),
    );
  }

  /** Canales activos para un evento (desde la caché). Evento fuera del catálogo → nada. */
  channelsFor(event: string): { push: boolean; email: boolean; telegram: boolean } {
    return this.cache.get(event) ?? { push: false, email: false, telegram: false };
  }

  async list(): Promise<AlertRule[]> {
    const rows = await this.app.prisma.alertRule.findMany();
    const byEvent = new Map(rows.map((r) => [r.event, r]));
    return ALERT_EVENTS.map(({ event, label }) => {
      const r = byEvent.get(event);
      return {
        event,
        label,
        push: r?.push ?? DEFAULT_CHANNELS.push,
        email: r?.email ?? DEFAULT_CHANNELS.email,
        telegram: r?.telegram ?? DEFAULT_CHANNELS.telegram,
      };
    });
  }

  async update(event: string, patch: UpdateAlertRuleRequest): Promise<AlertRule | null> {
    const label = LABEL_BY_EVENT.get(event);
    if (!label) return null; // fuera del catálogo
    const row = await this.app.prisma.alertRule.upsert({
      where: { event },
      create: {
        event,
        push: patch.push ?? DEFAULT_CHANNELS.push,
        email: patch.email ?? DEFAULT_CHANNELS.email,
        telegram: patch.telegram ?? DEFAULT_CHANNELS.telegram,
      },
      update: {
        ...(patch.push !== undefined ? { push: patch.push } : {}),
        ...(patch.email !== undefined ? { email: patch.email } : {}),
        ...(patch.telegram !== undefined ? { telegram: patch.telegram } : {}),
      },
    });
    await this.reload();
    return { event, label, push: row.push, email: row.email, telegram: row.telegram };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Configuración de alertas (decorada en `server.ts`). */
    alertConfig?: AlertConfigService;
  }
}
