/**
 * Cotas (mín/máx) de los ajustes numéricos sensibles a la seguridad que se
 * pueden editar en caliente (US-75, F5 del modelo de amenazas).
 *
 * Sin un máximo, un `accessTokenTtl` enorme haría los access tokens casi eternos
 * (anulando la garantía de "vida corta", que es lo que hace tolerable que el
 * access no sea revocable, F9) y un `loginRateLimit` desmedido neutralizaría el
 * freno a la fuerza bruta. Las cotas se aplican **al escribir** (`PATCH
 * /system/settings`, así el admin ve el valor efectivo) y **al leer** (defensa en
 * profundidad: aunque el valor llegue por otra vía —DB directa, migración— el
 * runtime lo acota igualmente).
 */

export interface NumericBound {
  min: number;
  max: number;
}

export const SETTING_BOUNDS = {
  /** TTL del access token en segundos. Máx 1 h para preservar la vida corta. */
  accessTokenTtl: { min: 60, max: 3600 },
  /** Intentos de login por minuto por IP. Mín 1 (nunca 0 = lockout total). */
  loginRateLimit: { min: 1, max: 1000 },
  /** Retención de los rollups de tráfico en días (US-102). Mín 1, máx 1 año. */
  trafficRetentionDays: { min: 1, max: 365 },
  /** Retención de los rollups de energía en días (US-181). Mín 1, máx 1 año. */
  energyRetentionDays: { min: 1, max: 365 },
  /** Retención del registro de auditoría en días (US-102). Mín 1, máx 10 años. */
  auditRetentionDays: { min: 1, max: 3650 },
  /**
   * Intervalo del barrido de inventario en segundos. Mín 5 s: sin cota, un valor
   * fraccionario (`0.001`) o desbordado (Node normaliza delays > 2^31-1 a 1 ms)
   * convertía `setInterval` en un bucle apretado que martillea el driver/hardware
   * y satura la CPU. El valor 0 es un caso aparte (desactiva el barrido) que el
   * handler trata antes de acotar. Máx 1 h.
   */
  scanIntervalSec: { min: 5, max: 3600 },
  /**
   * Ventana de gracia de la presencia en minutos (US-169). Mín 1 (un móvil que
   * duerme el WiFi generaría salidas fantasma con 0); máx 3 h.
   */
  presenceGraceMin: { min: 1, max: 180 },
} satisfies Record<string, NumericBound>;

export type BoundedSettingKey = keyof typeof SETTING_BOUNDS;

/** Cota de un ajuste por clave, o `undefined` si la clave no tiene cota. */
export function boundFor(key: string): NumericBound | undefined {
  return (SETTING_BOUNDS as Record<string, NumericBound | undefined>)[key];
}

/**
 * Acota `value` al rango `[min, max]`. Devuelve `null` si `value` no es un número
 * finito, de modo que el llamante pueda recurrir a su propio fallback / ignorarlo.
 */
export function clampToBound(value: number, bound: NumericBound): number | null {
  if (!Number.isFinite(value)) return null;
  return Math.min(bound.max, Math.max(bound.min, value));
}
