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
}

export interface UpdateAlertRuleRequest {
  push?: boolean;
  email?: boolean;
}
