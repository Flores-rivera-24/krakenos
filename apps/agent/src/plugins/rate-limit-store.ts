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

/** Límite por defecto (intentos de login por minuto) cuando no hay setting. */
export const DEFAULT_LOGIN_RATE_LIMIT = 10;

let current = DEFAULT_LOGIN_RATE_LIMIT;

export const rateLimitStore = {
  /** Límite vigente leído por la ruta de login en cada petición. */
  getCurrent(): number {
    return current;
  },
  /** Actualiza el límite vigente. Ignora valores no positivos o no finitos. */
  update(value: number): void {
    if (Number.isFinite(value) && value > 0) {
      current = Math.floor(value);
    }
  },
  /** Restaura el valor por defecto (útil en tests). */
  reset(): void {
    current = DEFAULT_LOGIN_RATE_LIMIT;
  },
};
