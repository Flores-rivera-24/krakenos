import { useEffect, type ReactNode } from 'react';
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

/** Modal accesible mínimo (overlay + contenido), sin dependencias externas. */
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

  return (
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
          'relative z-10 w-full max-w-lg rounded-lg border border-border bg-card p-6 shadow-lg outline-none',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
