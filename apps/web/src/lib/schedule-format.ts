import type { TranslationKey, TranslationParams } from '@/lib/i18n';

/** La función de traducción, inyectada para que estos helpers sigan siendo puros. */
export type Traducir = (key: TranslationKey, params?: TranslationParams) => string;

/**
 * Formateo de días y horas compartido por las superficies que programan algo:
 * rutinas (US-167/US-256) y la ventana de vigilancia de las cámaras (US-186).
 *
 * Vivía en `lib/iot-schedules.ts` junto al cliente de una API que ya no existe
 * (US-256 absorbió los horarios IoT); aquí no arrastra ningún endpoint.
 */

/**
 * Etiquetas de los días de la semana (0=domingo), en las dos formas que usa la
 * app: **corta** («Dom») para listas y **inicial** («D») para las casillas de una
 * semana, donde no cabe más.
 *
 * US-270: eran dos constantes en español en **dos módulos distintos** —aquí las
 * cortas y en `lib/access.ts` las iniciales—, así que la app en inglés enseñaba
 * los días en español en Rutinas, Personas, la hora de dormir y la ventana de
 * vigilancia de las cámaras. Ahora hay una sola fuente y las dos formas se
 * traducen. Son **funciones** y no constantes porque el idioma se decide en
 * runtime: una constante se congelaría con el idioma que hubiera al importar el
 * módulo.
 */
const CLAVES_DIA_CORTO: readonly TranslationKey[] = [
  'day.short.0',
  'day.short.1',
  'day.short.2',
  'day.short.3',
  'day.short.4',
  'day.short.5',
  'day.short.6',
];

const CLAVES_DIA_INICIAL: readonly TranslationKey[] = [
  'day.initial.0',
  'day.initial.1',
  'day.initial.2',
  'day.initial.3',
  'day.initial.4',
  'day.initial.5',
  'day.initial.6',
];

/** «Dom Lun Mar…» — para listas donde cabe el nombre corto. */
export function diasCortos(t: Traducir): string[] {
  return CLAVES_DIA_CORTO.map((k) => t(k));
}

/** «D L M…» — para las siete casillas de una semana, donde no cabe más. */
export function diasIniciales(t: Traducir): string[] {
  return CLAVES_DIA_INICIAL.map((k) => t(k));
}

/**
 * "HH:MM" → minutos del día (0-1439). Una entrada ilegible cae a 0 en vez de
 * producir `NaN`: el valor alimenta el disparador de una rutina, y un `NaN` no
 * lo rechaza el navegador —lo rechaza el borde, con un 400 que el usuario no
 * puede relacionar con el campo de la hora.
 */
export function timeStringToMinute(value: string): number {
  const [h, m] = value.split(':').map(Number);
  const minute = (Number.isFinite(h) ? (h as number) : 0) * 60 + (Number.isFinite(m) ? (m as number) : 0);
  return Math.min(1439, Math.max(0, minute));
}

/** minutos del día → "HH:MM" para un `<input type="time">`. */
export function minuteToTimeString(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * Frase de un desfase solar: "Atardecer", "Atardecer −15 min", "Amanecer +30
 * min". El signo va con el menos tipográfico (−), como el resto del copy.
 */
export function formatSunOffset(
  event: 'sunrise' | 'sunset',
  offsetMin: number,
  t: Traducir,
): string {
  const base = t(event === 'sunrise' ? 'sun.sunrise' : 'sun.sunset');
  if (offsetMin === 0) return base;
  // El desfase es una plantilla completa y no un trozo pegado detrás: en otro
  // idioma puede querer ir delante, y el signo forma parte de ella.
  const sign = offsetMin > 0 ? '+' : '−';
  return t('sun.withOffset', { base, sign, min: Math.abs(offsetMin) });
}
