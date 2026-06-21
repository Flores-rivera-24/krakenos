/**
 * Tipos de autenticación WebAuthn / passkey (2FA opcional, US-50).
 * Nunca exponen la clave pública (`Bytes`) ni el `counter` del autenticador.
 */
export interface WebAuthnCredentialInfo {
  id: string;
  name: string;
  /** 'singleDevice' | 'multiDevice'. */
  deviceType: string;
  backedUp: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Resultado de registrar una passkey (US-50). Al registrar la **primera**, se
 * generan códigos de recuperación 2FA (US-59) que se muestran una sola vez.
 */
export interface RegisterPasskeyResult {
  credential: WebAuthnCredentialInfo;
  /** Solo presente si esta era la primera passkey; texto plano mostrado una vez. */
  backupCodes?: string[];
}

/** Códigos de recuperación 2FA recién generados (se muestran una sola vez, US-59). */
export interface BackupCodesResult {
  codes: string[];
}

/** Cuántos códigos de recuperación sin usar le quedan al usuario (US-59). */
export interface BackupCodesStatus {
  remaining: number;
}
