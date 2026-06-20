interface SparklineProps {
  /** Serie de valores (p. ej. bytes/seg). */
  points: number[];
  width?: number;
  height?: number;
  className?: string;
}

/**
 * Mini-gráfica inline (SVG puro, sin dependencias) para tendencias dentro de
 * cards/paneles, estilo UniFi. Devuelve `null` si hay menos de 2 puntos.
 */
export function Sparkline({ points, width = 120, height = 32, className }: SparklineProps) {
  if (points.length < 2) return null;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const path = points
    .map((v, i) => {
      const x = i * stepX;
      const y = height - ((v - min) / span) * height;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="Tendencia"
      preserveAspectRatio="none"
    >
      <path d={path} fill="none" stroke="var(--kr-accent)" strokeWidth={1.5} />
    </svg>
  );
}
