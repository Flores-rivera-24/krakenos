/** Estado del primer arranque del sistema. */
export interface SetupStatus {
  /** `true` si todavía no existe ningún usuario (hay que ejecutar el wizard). */
  needsSetup: boolean;
}

/** Datos del wizard de configuración inicial. */
export interface SetupInitRequest {
  /** Nombre del hogar (se guarda como ajuste del sistema). */
  homeName: string;
  email: string;
  displayName: string;
  password: string;
}
