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
