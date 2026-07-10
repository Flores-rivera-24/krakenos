/**
 * Reglas de alerta configurables (US-112). El catálogo de eventos alertables es
 * fijo (los eventos de seguridad con contenido definido); el usuario decide, por
 * evento, si notificar por **push** y/o por **email**.
 */
export interface AlertRule {
  /** Acción de auditoría (clave del catálogo). */
  event: string;
  /** Etiqueta legible del evento. */
  label: string;
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
