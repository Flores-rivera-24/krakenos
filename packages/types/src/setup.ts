/** Estado del primer arranque del sistema. */
export interface SetupStatus {
  /** `true` si todavía no existe ningún usuario (hay que ejecutar el wizard). */
  needsSetup: boolean;
  /**
   * `true` si `/setup/init` exige el token de configuración out-of-band (US-81):
   * el agente lo imprimió en su log al arrancar sin admin.
   */
  requiresToken: boolean;
}

/** Datos del wizard de configuración inicial. */
export interface SetupInitRequest {
  /** Nombre del hogar (se guarda como ajuste del sistema). */
  homeName: string;
  email: string;
  displayName: string;
  password: string;
  /**
   * Token de configuración out-of-band (US-81): impreso en el log/CLI del agente
   * al primer arranque sin admin. Requerido si el agente tiene un token activo.
   */
  setupToken?: string;
}
