import type { ReactNode } from 'react';
import { HelpHint } from '@/components/ui/help-hint';
import { cn } from '@/lib/utils';

export interface GlossaryTermProps {
  /** Definición corta en lenguaje sencillo del término. */
  definition: ReactNode;
  /** Término (usado como texto visible si no hay `children`, y en la etiqueta accesible). */
  term?: string;
  /** Contenido visible; si se omite, se muestra `term`. */
  children?: ReactNode;
  className?: string;
}

/**
 * Término de glosario: texto inline con subrayado punteado que, al enfocar,
 * pasar el ratón o hacer clic, revela una definición breve. Construido sobre
 * `HelpHint`, así que hereda su accesibilidad (teclado, Escape, describedby).
 *
 * Los datos del glosario viven fuera; este componente solo renderiza la
 * definición que recibe. Ej: `<GlossaryTerm term="SSID" definition="El nombre de tu red WiFi.">SSID</GlossaryTerm>`.
 */
export function GlossaryTerm({ definition, term, children, className }: GlossaryTermProps) {
  return (
    <HelpHint
      content={definition}
      triggerClassName={cn(
        'cursor-help align-baseline text-kr-primary underline decoration-dotted decoration-1 underline-offset-2 hover:text-kr-primary',
        className,
      )}
    >
      {children ?? term}
    </HelpHint>
  );
}
