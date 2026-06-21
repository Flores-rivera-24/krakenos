import type { LoginResponse } from '@krakenos/types';
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
import { api } from '@/lib/api';

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

/**
 * Completa el segundo factor del login (US-51): pide las opciones presentando el
 * token efímero `mfaToken` (que acredita la contraseña ya superada), firma el
 * challenge con la passkey y verifica para obtener la sesión. El `mfaToken` se
 * propaga a ambos pasos, atando primer y segundo factor.
 */
export async function completePasskeyLogin(
  email: string,
  mfaToken: string,
): Promise<LoginResponse> {
  const res = await api.post<{
    available: boolean;
    options?: PublicKeyCredentialRequestOptionsJSON;
  }>('/webauthn/authenticate/options', { email, mfaToken });
  if (!res.available || !res.options) {
    throw new Error('webauthn_unavailable');
  }
  const assertion = await startAuthentication(res.options);
  return api.post<LoginResponse>('/webauthn/authenticate/verify', {
    email,
    mfaToken,
    response: assertion,
  });
}
