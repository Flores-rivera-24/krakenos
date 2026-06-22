/**
 * Store en memoria de los `jti` de tokens `mfa-pending` ya consumidos, para
 * hacerlos **de un solo uso** (anti-replay dentro de su ventana de 120 s).
 *
 * El token `mfa-pending` es un JWT sin estado: por sí solo es **reproducible**
 * tantas veces como se quiera mientras no expire, lo que permitiría reintentar el
 * segundo factor (p. ej. adivinar códigos de recuperación) muchas veces con una
 * sola entrada de contraseña. Para evitarlo, los endpoints que **emiten sesión**
 * (`authenticate/verify`, `backup-codes/verify`) consumen el `jti`: el primer uso
 * lo registra y cualquier intento posterior con el mismo token se rechaza.
 *
 * Sigue el patrón del singleton en memoria de `plugins/rate-limit-store.ts`: el
 * agente es un único proceso (electrodoméstico doméstico), así que no hace falta
 * almacenamiento compartido. Cada `jti` se recuerda solo hasta su expiración (tras
 * ella el JWT ya no verifica), de modo que la memoria queda acotada.
 */

/** `jti` → epoch (ms) de expiración del token, para poder purgar los caducados. */
const consumed = new Map<string, number>();

/** Elimina los `jti` cuya expiración ya pasó (el JWT ya sería inválido). */
function purgeExpired(now: number): void {
  for (const [jti, expiresAtMs] of consumed) {
    if (expiresAtMs <= now) consumed.delete(jti);
  }
}

export const mfaTokenStore = {
  /**
   * Marca un `jti` como consumido. Devuelve `true` si era la primera vez (uso
   * legítimo) y `false` si ya estaba consumido (replay) → el llamante rechaza.
   */
  consume(jti: string, expiresAtMs: number): boolean {
    const now = Date.now();
    purgeExpired(now);
    if (consumed.has(jti)) return false;
    consumed.set(jti, expiresAtMs);
    return true;
  },

  /** Vacía el registro (útil en tests). */
  reset(): void {
    consumed.clear();
  },
};
