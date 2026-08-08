import type { SignalQuality } from '@krakenos/types';
import { formatDbm, heatmapRgba, SIGNAL_QUALITY_KEYS, signalQualityColorVar } from '@/lib/coverage-format';
import { useT } from '@/lib/i18n';

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
  const t = useT();
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
        <span>{t('coverage.legend.title')}</span>
        <span>{formatDbm(maxDbm)}</span>
      </div>
      <div
        className="h-3 w-full rounded-full border border-kr"
        style={{ background: gradient }}
        role="img"
        aria-label={t('coverage.legend.aria', {
          min: formatDbm(minDbm),
          max: formatDbm(maxDbm),
        })}
      />
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {QUALITY_ORDER.map((q) => (
          <li key={q} className="flex items-center gap-1.5 text-kr-xs text-kr-secondary">
            <span
              aria-hidden
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: signalQualityColorVar(q) }}
            />
            {t(SIGNAL_QUALITY_KEYS[q])}
          </li>
        ))}
      </ul>
    </div>
  );
}
