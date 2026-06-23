import { ApiRequestError } from '@/lib/api';

/**
 * Traduce un error de `lib/api` a un mensaje honesto para la UI (US-93),
 * distinguiendo el fallo de **red / servidor inaccesible** (la `fetch` rechazó
 * sin respuesta, no es un `ApiRequestError`) de un **4xx/5xx** del agente (que
 * sí llega como `ApiRequestError` con `status` y, normalmente, un `message`).
 *
 * Reutiliza el `ApiRequestError` existente; no introduce un sistema de errores
 * nuevo (mismo criterio que el `HttpError` del login en US-55).
 *
 * @param fallback Texto base de la acción ("No se pudo cargar la VPN"); se usa
 *   cuando el servidor responde un error sin cuerpo legible.
 */
export function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) {
    const message = err.body?.message?.trim();
    return message ? message : `${fallback} (error ${err.status}).`;
  }
  return 'No se pudo conectar con el servidor. Revisa tu conexión.';
}
