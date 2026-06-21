import { cn } from '@/lib/utils';

/**
 * Isotipo "Orbital" de KrakenOS (cabeza de kraken + nodos de red en simetría
 * hexagonal). Geométrico y escalable. Usa `currentColor` para los trazos y la
 * cabeza, así que el color se controla con `text-*` en el contenedor
 * (p. ej. `text-kr-accent`). Decorativo por defecto (`aria-hidden`): el nombre
 * accesible lo aporta el wordmark "KrakenOS" contiguo. Fuente: `Icons/logo-mark-mono.svg`.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 120 120"
      className={cn('shrink-0', className)}
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
        <path d="M60,44 Q63,29 60,13" />
        <path d="M73.9,52 Q88,42 99.8,37" />
        <path d="M73.9,68 Q88,78 99.8,83" />
        <path d="M60,76 Q57,91 60,107" />
        <path d="M46.1,68 Q32,78 20.2,83" />
        <path d="M46.1,52 Q32,42 20.2,37" />
      </g>
      <g fill="currentColor">
        <circle cx="60" cy="13" r="3.5" />
        <circle cx="99.8" cy="37" r="3.5" />
        <circle cx="99.8" cy="83" r="3.5" />
        <circle cx="60" cy="107" r="3.5" />
        <circle cx="20.2" cy="83" r="3.5" />
        <circle cx="20.2" cy="37" r="3.5" />
        <circle cx="60" cy="60" r="16" />
      </g>
      <g fill="#ffffff">
        <circle cx="54" cy="57" r="3" />
        <circle cx="66" cy="57" r="3" />
      </g>
    </svg>
  );
}
