import type { MotionArming, MotionSensitivity } from '@krakenos/types';

/**
 * Detección de movimiento por **diferencia de fotogramas** (US-186). Todo es
 * **puro y testeable** (sin ML ni nube): compara dos huellas en escala de grises
 * del mismo tamaño y decide si hay movimiento.
 *
 * Robustez ante **cambios de luz**: un encendido/apagado o una nube desplaza el
 * brillo de *todos* los píxeles casi por igual. Antes de contar píxeles cambiados
 * se resta la **media del delta** (el desplazamiento global), de modo que un
 * cambio uniforme de iluminación no cuenta como movimiento; solo lo hace un
 * cambio *localizado* (una persona, un coche) que se aparta de esa media.
 */

export interface MotionThresholds {
  /** Diferencia de gris (0-255) a partir de la cual un píxel «cambió». */
  pixelThreshold: number;
  /** Fracción mínima de píxeles cambiados para declarar movimiento (0-1). */
  minChangedFraction: number;
}

/** Mapea la sensibilidad elegida por el usuario a umbrales concretos. */
export function sensitivityToThresholds(sensitivity: MotionSensitivity): MotionThresholds {
  switch (sensitivity) {
    case 'high':
      return { pixelThreshold: 12, minChangedFraction: 0.02 };
    case 'low':
      return { pixelThreshold: 32, minChangedFraction: 0.1 };
    case 'medium':
    default:
      return { pixelThreshold: 20, minChangedFraction: 0.05 };
  }
}

export interface MotionResult {
  motion: boolean;
  /** Fracción de píxeles con cambio significativo (tras compensar el brillo). */
  score: number;
}

/**
 * Compara dos huellas de gris. Devuelve la fracción de píxeles que cambiaron por
 * encima del umbral **tras compensar el desplazamiento global de brillo**, y si
 * supera la fracción mínima. Sin fotograma previo (o tamaños distintos) → sin
 * movimiento (el primer fotograma solo siembra el estado).
 */
export function detectMotion(
  prev: Uint8Array | null,
  curr: Uint8Array,
  thresholds: MotionThresholds,
): MotionResult {
  if (!prev || prev.length === 0 || prev.length !== curr.length) {
    return { motion: false, score: 0 };
  }
  const n = curr.length;
  // 1) Desplazamiento global de brillo = media de (curr - prev).
  let sum = 0;
  for (let i = 0; i < n; i++) sum += curr[i]! - prev[i]!;
  const meanDelta = sum / n;
  // 2) Cuenta píxeles cuyo cambio se aparta de ese desplazamiento global.
  let changed = 0;
  for (let i = 0; i < n; i++) {
    const residual = Math.abs(curr[i]! - prev[i]! - meanDelta);
    if (residual > thresholds.pixelThreshold) changed++;
  }
  const score = changed / n;
  return { motion: score >= thresholds.minChangedFraction, score };
}

/**
 * ¿La cámara está **armada** en `date` según su modo? `always` siempre; `never`
 * nunca; `schedule` si alguna ventana cubre el momento (día permitido y minuto
 * dentro de `[from, to)`, con envoltura de medianoche si `from > to`).
 */
export function isArmed(arming: MotionArming, date: Date): boolean {
  if (arming.mode === 'always') return true;
  if (arming.mode === 'never') return false;
  const minute = date.getHours() * 60 + date.getMinutes();
  const day = date.getDay();
  return arming.windows.some((w) => {
    if (w.days && !w.days.includes(day)) return false;
    return w.fromMinute <= w.toMinute
      ? minute >= w.fromMinute && minute < w.toMinute
      : minute >= w.fromMinute || minute < w.toMinute;
  });
}
