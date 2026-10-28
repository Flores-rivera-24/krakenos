import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { cn } from '@/lib/utils';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Etiqueta accesible del diálogo (si su contenido no aporta un título claro). */
  'aria-label'?: string;
  /** Id del elemento que titula el diálogo (alternativa a `aria-label`). */
  'aria-labelledby'?: string;
}

/**
 * Modal accesible mínimo (overlay + contenido), sin dependencias externas. Se monta vía
 * `createPortal` en `document.body`, como `Slideover`: el `<main>` conserva un `transform`
 * tras su animación de entrada y eso lo convierte en el bloque contenedor de todo `fixed`
 * de dentro. Sin portal, el diálogo se centraba en `main` (no en la ventana), el fondo solo
 * cubría `main` y la barra inferior del celular se pintaba encima del panel.
 */
export function Dialog({
  open,
  onClose,
  children,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledby,
}: DialogProps) {
  const panelRef = useFocusTrap<HTMLDivElement>(open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} aria-hidden />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        tabIndex={-1}
        className={cn(
          'relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-lg outline-hidden',
          className,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
