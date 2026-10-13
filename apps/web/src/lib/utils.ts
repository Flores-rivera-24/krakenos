import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * Escala tipográfica propia (`--text-kr-*` en `index.css`). Sin declararla,
 * tailwind-merge no sabe que `text-kr-sm` es un TAMAÑO y lo trata como un color
 * (acepta cualquier valor), así que `cn('text-kr-sm', 'text-kr-primary')` se
 * quedaba solo con la última. Si se añade un paso a la escala, va aquí también.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['kr-xs', 'kr-sm', 'kr-base', 'kr-lg', 'kr-xl', 'kr-2xl'],
    },
  },
});

/** Combina clases de Tailwind resolviendo conflictos (helper estándar de shadcn/ui). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
