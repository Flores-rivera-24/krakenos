import { Loader2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';

interface Props {
  /** Acción de borrado. La fila puede desmontarse al recargar la lista tras resolver. */
  onDelete: () => Promise<unknown>;
  children: ReactNode;
  variant?: ButtonProps['variant'];
  className?: string;
  'aria-label'?: string;
}

/**
 * Botón de borrado con estado pendiente por fila (US-96): se deshabilita y muestra
 * un spinner mientras la petición está en vuelo, así dos borrados seguidos no se
 * pisan ni parecen colgados. Gestiona su propio `pending` (cada fila es independiente)
 * y detiene la propagación para no disparar el click de la fila que lo contiene.
 */
export function DeleteButton({ onDelete, children, variant = 'ghost', className, ...rest }: Props) {
  const [pending, setPending] = useState(false);

  const handle = async () => {
    if (pending) return;
    setPending(true);
    try {
      await onDelete();
    } finally {
      // Si la lista se recarga, esta fila se desmonta; el setState es un no-op
      // tolerado. Si falla (el handler captura y avisa), reactiva para reintentar.
      setPending(false);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size="sm"
      disabled={pending}
      aria-busy={pending}
      aria-label={rest['aria-label']}
      onClick={(e) => {
        e.stopPropagation();
        void handle();
      }}
      className={className}
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </Button>
  );
}
