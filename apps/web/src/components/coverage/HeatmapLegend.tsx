import type { SignalQuality } from '@krakenos/types';
import { formatDbm, heatmapRgba, SIGNAL_QUALITY_LABELS, signalQualityColorVar } from '@/lib/coverage-format';

interface Props {
  /** Cota inferior del degradado (dBm más débil). */
  minDbm?: number;
  /** Cota superior del degradado (dBm más fuerte). */
  maxDbm?: number;
  className?: string;
}

/** Orden de peor a mejor calidad para las etiquetas de la leyenda. */
const QUALITY_ORDER: SignalQuality[] = ['excellent', 'good', 'fair', 'weak', 'none'];

/** Nº de paradas para construir el degradado CSS con los mismos colores del canvas. */
const GRADIENT_STEPS = 8;

/**
 * Leyenda del mapa de calor: una barra con el degradado dBm (mismos colores que
 * pinta el lienzo) y las etiquetas de calidad de señal. Reutiliza las funciones
 * puras de `coverage-format` para no duplicar la escala.
 */
export function HeatmapLegend({ minDbm = -85, maxDbm = -45, className }: Props) {
  // Construye el degradado muestreando la misma función que el canvas.
  const stops: string[] = [];
  for (let i = 0; i <= GRADIENT_STEPS; i++) {
    const t = i / GRADIENT_STEPS;
    // De izquierda (débil, minDbm) a derecha (fuerte, maxDbm).
    const dbm = minDbm + (maxDbm - minDbm) * t;
    stops.push(`${heatmapRgba(dbm, 1)} ${Math.round(t * 100)}%`);
  }
  const gradient = `linear-gradient(to right, ${stops.join(', ')})`;

  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between text-kr-xs text-kr-muted">
        <span>{formatDbm(minDbm)}</span>
        <span>Intensidad de señal</span>
        <span>{formatDbm(maxDbm)}</span>
      </div>
      <div
        className="h-3 w-full rounded-full border border-kr"
        style={{ background: gradient }}
        role="img"
        aria-label={`Degradado de señal de ${formatDbm(minDbm)} a ${formatDbm(maxDbm)}`}
      />
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {QUALITY_ORDER.map((q) => (
          <li key={q} className="flex items-center gap-1.5 text-kr-xs text-kr-secondary">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: signalQualityColorVar(q) }}
            />
            {SIGNAL_QUALITY_LABELS[q]}
          </li>
        ))}
      </ul>
    </div>
  );
}
