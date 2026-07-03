import { cn } from '@/lib/utils';

/**
 * Placeholder de carga animado (US-93): evita el "flash en blanco" mientras se
 * resuelve la primera petición. US-160: el pulse plano pasa a un barrido shimmer
 * (`kr-shimmer`) — un gradiente que recorre la superficie, más "en vivo" —
 * respetando prefers-reduced-motion (queda estático). Tokens kr-*.
 */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('kr-shimmer rounded-md bg-kr-elevated', className)} />;
}

/** Filas de carga para tablas: `rows` filas con una barra que abarca `cols` columnas. */
export function SkeletonRows({ rows = 3, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-t border-kr">
          <td colSpan={cols} className="px-3 py-2.5">
            <Skeleton className="h-4 w-full" />
          </td>
        </tr>
      ))}
    </>
  );
}
