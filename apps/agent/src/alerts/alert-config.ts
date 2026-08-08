import { ALERT_EVENTS, type AlertRule, type UpdateAlertRuleRequest } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';

/**
 * Catálogo FIJO de eventos alertables (US-112): los eventos de seguridad para los
 * que existe contenido de notificación. El usuario solo decide, por evento, si
 * push y/o email — no puede inventar eventos sin contenido.
 *
 * Vive en `@krakenos/types` (US-270) y aquí se reexporta para no tocar a sus
 * consumidores internos ni al gate de contenido.
 *
 * ⚠️ Antes esta lista llevaba **la etiqueta en español pegada al evento**, y esa
 * etiqueta viajaba en la respuesta de la API. Como el agente no tiene i18n, la
 * app en inglés enseñaba las trece filas de Ajustes → Alertas en español,
 * `aria-label` incluidos. Ahora la API devuelve **la clave** y el copy lo pone la
 * web, que es quien sabe en qué idioma está el usuario.
 *
 * Notas del catálogo que conviene no perder:
 *  - `auth.recovery_used`: entrar con un código de recuperación es saltarse la
 *    contraseña. Es legítimo (para eso están) y a la vez es justo lo que querría
 *    hacer quien te robó la libreta donde los apuntaste.
 *  - `dns.new_destination` NO es una variante de `inventory.unknown_device`:
 *    aquel avisa de que APARECE un aparato, este de que uno que ya estaba CAMBIA
 *    de comportamiento — apagar uno no debe apagar el otro.
 *  - `alarm.smoke`/`alarm.co` son eventos propios y no variantes de
 *    `alarm.triggered`, porque avisan aunque la alarma esté desarmada: bajo el
 *    mismo evento, desactivar el aviso de intrusión apagaría el de incendio.
 *  - `system.tls_expiring`: el certificado caduca en silencio y se lleva por
 *    delante la PWA, los avisos y las passkeys.
 */
export { ALERT_EVENTS };

const EVENTOS_DEL_CATALOGO = new Set<string>(ALERT_EVENTS);

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
    for (const event of ALERT_EVENTS) {
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
    return ALERT_EVENTS.map((event) => {
      const r = byEvent.get(event);
      return {
        event,
        push: r?.push ?? DEFAULT_CHANNELS.push,
        email: r?.email ?? DEFAULT_CHANNELS.email,
        telegram: r?.telegram ?? DEFAULT_CHANNELS.telegram,
      };
    });
  }

  async update(event: string, patch: UpdateAlertRuleRequest): Promise<AlertRule | null> {
    if (!EVENTOS_DEL_CATALOGO.has(event)) return null; // fuera del catálogo
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
    return { event, push: row.push, email: row.email, telegram: row.telegram };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Configuración de alertas (decorada en `server.ts`). */
    alertConfig?: AlertConfigService;
  }
}
