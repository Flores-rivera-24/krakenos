import { Smartphone } from 'lucide-react';
import type { ReactNode } from 'react';
import { Callout } from '@/components/ui/callout';
import { CopyButton } from '@/components/ui/copy-button';
import { cn } from '@/lib/utils';

export interface GuideStepProps {
  /** Número visible del paso (1-based). */
  index: number;
  title: ReactNode;
  /** Cuerpo/explicación del paso. */
  children?: ReactNode;
  /** Comando o valor copiable, mostrado en un bloque monoespaciado con CopyButton. */
  command?: string;
  /** Nota informativa opcional bajo el paso (Callout `info`). */
  note?: ReactNode;
  /** Advertencia opcional bajo el paso (Callout `warning`). */
  warning?: ReactNode;
  /** Marca el paso como acción que ocurre en el dispositivo del usuario. */
  external?: boolean;
  className?: string;
}

/**
 * Paso de instrucción numerado: badge de índice, título, cuerpo, bloque de
 * comando copiable opcional y notas/advertencias. La bandera `external` lo
 * estiliza como "esto pasa en tu dispositivo". Pensado para ir dentro de
 * `GuideStepList` (renderiza un `<li>`).
 */
export function GuideStep({
  index,
  title,
  children,
  command,
  note,
  warning,
  external,
  className,
}: GuideStepProps) {
  return (
    <li className={cn('flex gap-3', className)}>
      <span
        aria-hidden
        className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border bg-kr-elevated text-kr-sm font-semibold',
          external ? 'border-info text-info' : 'border-kr text-kr-primary',
        )}
      >
        {index}
      </span>
      <div className="min-w-0 flex-1 space-y-2 pb-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-kr-primary">{title}</p>
          {external && (
            <span className="inline-flex items-center gap-1 text-kr-xs text-info">
              <Smartphone className="h-4 w-4" aria-hidden />
              En tu dispositivo
            </span>
          )}
        </div>
        {children && <div className="text-kr-sm text-kr-secondary">{children}</div>}
        {command && (
          <div className="flex items-center gap-2 rounded-md border border-kr bg-kr-base px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-kr-sm text-kr-primary">
              {command}
            </code>
            <CopyButton value={command} />
          </div>
        )}
        {note && <Callout variant="info">{note}</Callout>}
        {warning && <Callout variant="warning">{warning}</Callout>}
      </div>
    </li>
  );
}

export interface GuideStepListProps {
  children: ReactNode;
  className?: string;
}

/** Lista ordenada de `GuideStep` (renderiza un `<ol>`). */
export function GuideStepList({ children, className }: GuideStepListProps) {
  return <ol className={cn('space-y-4', className)}>{children}</ol>;
}
