import type { PropsWithChildren } from 'react';
import { cn } from '@/lib/utils';

/**
 * Ilustraciones de producto (US-161) — reemplazan los iconos de línea genéricos
 * por renders 2.5D reconocibles de cada tipo de aparato. Vector inline: sin red
 * (respeta el modo self-hosted + CSP `connect-src 'self'`), sin riesgo de
 * licencia, nítido a cualquier DPI y coherente con el sistema de diseño. Los
 * "materiales" son los tokens `--kr-art-*` (ver index.css).
 */
export interface ArtProps {
  className?: string;
  /** Si se pasa, el SVG se anuncia como imagen con este nombre; si no, decorativo. */
  title?: string;
}

/** Lienzo común 64×64 de las ilustraciones. */
export function ArtSvg({ className, title, children }: PropsWithChildren<ArtProps>) {
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}
