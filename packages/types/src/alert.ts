/**
 * Reglas de alerta configurables (US-112). El catálogo de eventos alertables es
 * fijo (los eventos de seguridad con contenido definido); el usuario decide, por
 * evento, si notificar por **push** y/o por **email**.
 */
/**
 * Catálogo **cerrado** de eventos alertables. Fuente única, y vive aquí y no en el
 * agente por una razón concreta (US-270): la etiqueta que ve el usuario tiene que
 * traducirse, y el catálogo de la web se declara `Record<AlertEvent, …>` para que
 * **añadir un evento no compile** hasta darle su copy en los dos idiomas.
 *
 * Antes la etiqueta viajaba en la respuesta de la API, escrita en español dentro
 * del agente —que no tiene i18n—, así que Ajustes → Alertas enseñaba sus trece
 * filas en español con la app en inglés, y sus `aria-label` también.
 */
export const ALERT_EVENTS = [
  'auth.login_failed',
  'auth.login_locked',
  'auth.refresh_reuse',
  'auth.recovery_used',
  'device.block',
  'inventory.unknown_device',
  'dns.new_destination',
  'energy.threshold',
  'camera.motion',
  'alarm.triggered',
  'alarm.smoke',
  'alarm.co',
  'alarm.sensor_fault',
  'alarm.disarm_denied',
  'system.tls_expiring',
] as const;

export type AlertEvent = (typeof ALERT_EVENTS)[number];

export interface AlertRule {
  /** Acción de auditoría (clave del catálogo). Es lo que la UI traduce. */
  event: string;
  push: boolean;
  email: boolean;
  /** Canal Telegram (US-180): bot opt-in por variables de entorno. */
  telegram: boolean;
}

export interface UpdateAlertRuleRequest {
  push?: boolean;
  email?: boolean;
  telegram?: boolean;
}

/** Frecuencia del resumen del hogar (US-180). Fuente única (schemas derivan). */
export const DIGEST_FREQUENCIES = ['off', 'daily', 'weekly'] as const;
export type DigestFrequency = (typeof DIGEST_FREQUENCIES)[number];
