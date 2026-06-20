import {
  startAuthentication as browserStartAuthentication,
  startRegistration as browserStartRegistration,
  WebAuthnError,
} from '@simplewebauthn/browser';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

/** `true` si el navegador soporta la API WebAuthn (passkeys). */
export function isWebAuthnSupported(): boolean {
  return typeof window !== 'undefined' && window.PublicKeyCredential !== undefined;
}

/**
 * ¿El error corresponde a una cancelación del usuario (cerró el diálogo, canceló
 * la biometría)? Se distingue para que la UI ofrezca reintentar en vez de tratarlo
 * como un fallo de red/credencial.
 */
function isCancellation(err: unknown): boolean {
  if (err instanceof WebAuthnError) return err.code === 'ERROR_CEREMONY_ABORTED';
  return err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError');
}

/** Lanza un par de claves y devuelve la respuesta de registro. */
export async function startRegistration(
  options: PublicKeyCredentialCreationOptionsJSON,
): Promise<RegistrationResponseJSON> {
  try {
    return await browserStartRegistration({ optionsJSON: options });
  } catch (err) {
    if (isCancellation(err)) throw new Error('webauthn_cancelled');
    throw err;
  }
}

/** Firma el challenge con una passkey existente y devuelve la respuesta. */
export async function startAuthentication(
  options: PublicKeyCredentialRequestOptionsJSON,
): Promise<AuthenticationResponseJSON> {
  try {
    return await browserStartAuthentication({ optionsJSON: options });
  } catch (err) {
    if (isCancellation(err)) throw new Error('webauthn_cancelled');
    throw err;
  }
}
