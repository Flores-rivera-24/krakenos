import type { ReactNode } from 'react';
import { HelpHint } from '@/components/ui/help-hint';
import { getGlossaryEntry } from '@/lib/guides';

export interface GlossaryHintProps {
  /** Clave del glosario (`@/lib/guides`), p. ej. "ssid". */
  termKey: string;
  /** Texto en lenguaje llano si la clave no existe en el glosario. */
  fallback?: ReactNode;
  /** Lado de la burbuja respecto al icono. */
  placement?: 'top' | 'bottom';
}

/**
 * Pista de ayuda contextual (US-150) respaldada por el glosario compartido: dado
 * el `termKey`, muestra un pequeño "?" que revela la definición en español llano.
 *
 * Solo **compone** `HelpHint` + `getGlossaryEntry` (no reconstruye nada ni edita
 * el glosario). Si el término no está en el glosario, cae al `fallback` en texto
 * llano; si tampoco lo hay, no renderiza nada.
 */
export function GlossaryHint({ termKey, fallback, placement }: GlossaryHintProps) {
  const entry = getGlossaryEntry(termKey);
  if (!entry) {
    return fallback ? <HelpHint content={fallback} placement={placement} /> : null;
  }
  return (
    <HelpHint
      placement={placement}
      label={`¿Qué es ${entry.term}?`}
      content={
        <span className="block">
          <strong className="text-kr-primary">{entry.term}.</strong> {entry.short}
        </span>
      }
    />
  );
}
