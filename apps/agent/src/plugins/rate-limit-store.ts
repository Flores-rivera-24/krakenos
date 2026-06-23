/**
 * Store en memoria con el límite de intentos de login vigente (US-47).
 *
 * `@fastify/rate-limit` fija su configuración al registrar la ruta, así que no
 * se puede cambiar en caliente re-registrando el plugin. En su lugar, la ruta de
 * login lee `max` desde este singleton **en cada petición** (vía la función
 * `max` que admite `@fastify/rate-limit`), y el endpoint de ajustes lo actualiza
 * cuando cambia la setting `loginRateLimit`. Así el cambio tiene efecto inmediato
 * sin reiniciar el agente ni re-registrar plugins.
 */

import { SETTING_BOUNDS, clampToBound } from '../config/settings-bounds.js';

/** Límite por defecto (intentos de login por minuto) cuando no hay setting. */
export const DEFAULT_LOGIN_RATE_LIMIT = 10;

let current = DEFAULT_LOGIN_RATE_LIMIT;

export const rateLimitStore = {
  /** Límite vigente leído por la ruta de login en cada petición. */
  getCurrent(): number {
    return current;
  },
  /**
   * Actualiza el límite vigente. Ignora valores no finitos y **acota** el resto
   * al rango permitido (US-75, F5): un valor desmedido no puede neutralizar el
   * freno a la fuerza bruta, ni un 0 bloquear todos los logins.
   */
  update(value: number): void {
    const clamped = clampToBound(value, SETTING_BOUNDS.loginRateLimit);
    if (clamped !== null) current = Math.floor(clamped);
  },
  /** Restaura el valor por defecto (útil en tests). */
  reset(): void {
    current = DEFAULT_LOGIN_RATE_LIMIT;
  },
};
