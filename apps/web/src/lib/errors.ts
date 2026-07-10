import { ApiRequestError } from '@/lib/api';
import { es } from '@/lib/i18n/catalog/es';
import { getLocale, t, type TranslationKey } from '@/lib/i18n';

/**
 * Traduce un error de `lib/api` a un mensaje honesto para la UI (US-93),
 * distinguiendo el fallo de **red / servidor inaccesible** (la `fetch` rechazó
 * sin respuesta, no es un `ApiRequestError`) de un **4xx/5xx** del agente (que
 * sí llega como `ApiRequestError` con `status` y, normalmente, un `message`).
 *
 * Localización (US-177): el mensaje de red se traduce con `t()`. Para los
 * errores del agente, cuando el idioma activo **no es español** y el error trae
 * un `code` con traducción conocida, se usa la traducción por código (+ los
 * `details` como params de interpolación); en español se conserva el mensaje que
 * el agente ya devuelve en español (sin regresiones de texto — lo asertan los tests).
 *
 * @param fallback Texto base de la acción ("No se pudo cargar la VPN"); se usa
 *   cuando el servidor responde un error sin cuerpo legible.
 */
export function describeError(err: unknown, fallback: string): string {
  if (err instanceof ApiRequestError) {
    // Traducción por código (solo si el idioma activo no es español).
    if (getLocale() !== 'es' && err.body?.code) {
      const key = `errors.code.${err.body.code}` as TranslationKey;
      if (key in es) {
        return t(key, err.body.details as Record<string, string | number> | undefined);
      }
    }
    const message = err.body?.message?.trim();
    return message ? message : `${fallback} (error ${err.status}).`;
  }
  return t('errors.network');
}
