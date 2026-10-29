import type { ReactNode } from 'react';
import { HelpHint } from '@/components/ui/help-hint';
import { getGlossaryEntry } from '@/lib/guides/glossary';
import { useT } from '@/lib/i18n';

export interface GlossaryHintProps {
  /** Clave del glosario (`@/lib/guides`), p. ej. "ssid". */
  termKey: string;
  /** Texto en lenguaje llano si la clave no existe en el glosario. */
  fallback?: ReactNode;
  /** Lado de la burbuja respecto al icono. */
  placement?: 'top' | 'bottom';
}

/** Término fuera del glosario: cae al `fallback`; sin él, no renderiza nada. */
export function GlossaryHint({ termKey, fallback, placement }: GlossaryHintProps) {
  const t = useT();
  const entry = getGlossaryEntry(termKey);
  if (!entry) {
    return fallback ? <HelpHint content={fallback} placement={placement} /> : null;
  }
  return (
    <HelpHint
      placement={placement}
      label={t('glossary.whatIs', { term: entry.term })}
      content={
        <span className="block">
          <strong className="text-kr-primary">{entry.term}.</strong> {entry.short}
        </span>
      }
    />
  );
}
