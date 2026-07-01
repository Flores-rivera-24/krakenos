import type { SignalQuality, WallMaterial } from '@krakenos/types';
import { signalQuality } from '@krakenos/types';

/** Etiquetas en español de cada material de pared/obstáculo. */
export const WALL_MATERIAL_LABELS: Record<WallMaterial, string> = {
  drywall: 'Pladur/tabique',
  wood: 'Madera',
  glass: 'Cristal',
  brick: 'Ladrillo',
  concrete: 'Hormigón',
  metal: 'Metal',
};

/** Etiquetas en español de cada categoría de calidad de señal. */
export const SIGNAL_QUALITY_LABELS: Record<SignalQuality, string> = {
  excellent: 'Excelente',
  good: 'Buena',
  fair: 'Aceptable',
  weak: 'Débil',
  none: 'Sin señal',
};

/** Variable CSS `--kr-*` para colorear cada categoría de calidad de señal. */
export function signalQualityColorVar(quality: SignalQuality): string {
  switch (quality) {
    case 'excellent':
    case 'good':
      return 'var(--kr-success)';
    case 'fair':
      return 'var(--kr-warning)';
    case 'weak':
      return 'var(--kr-danger)';
    case 'none':
      return 'var(--kr-text-muted)';
  }
}

/** Formatea un RSSI en dBm; `null` → em dash. */
export function formatDbm(dbm: number | null): string {
  if (dbm == null) return '—';
  return `${Math.round(dbm)} dBm`;
}

/**
 * Paradas del degradado, de señal fuerte a débil (estilo UniFi): verde en
 * `-50` dBm o mejor, amarillo en `-67` dBm, rojo en `-80` dBm o peor. Se
 * interpola linealmente en el espacio RGB entre paradas contiguas.
 */
const GRADIENT_STOPS: readonly [dbm: number, r: number, g: number, b: number][] = [
  [-50, 63, 185, 80], // verde (--kr-success)
  [-67, 210, 153, 34], // amarillo (--kr-warning)
  [-80, 248, 81, 73], // rojo (--kr-danger)
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Color `rgba(...)` para pintar una celda del mapa de calor de cobertura.
 * `null` → completamente transparente (sin dato). Interpola verde → amarillo
 * → rojo según el RSSI, clampando en los extremos del degradado.
 */
export function heatmapRgba(dbm: number | null, alpha = 0.55): string {
  if (dbm == null) return 'rgba(0,0,0,0)';

  const stops = GRADIENT_STOPS;
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;

  if (dbm >= first[0]) {
    return `rgba(${first[1]},${first[2]},${first[3]},${alpha})`;
  }
  if (dbm <= last[0]) {
    return `rgba(${last[1]},${last[2]},${last[3]},${alpha})`;
  }

  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i]!;
    const to = stops[i + 1]!;
    if (dbm <= from[0] && dbm >= to[0]) {
      const t = (from[0] - dbm) / (from[0] - to[0]);
      const r = Math.round(lerp(from[1], to[1], t));
      const g = Math.round(lerp(from[2], to[2], t));
      const b = Math.round(lerp(from[3], to[3], t));
      return `rgba(${r},${g},${b},${alpha})`;
    }
  }

  // Inalcanzable dados los clamps anteriores, pero exhaustivo por si acaso.
  return `rgba(${last[1]},${last[2]},${last[3]},${alpha})`;
}

// Reexportado por conveniencia: la UI clasifica el RSSI con la misma función
// que usa el agente, sin duplicar los umbrales.
export { signalQuality };
