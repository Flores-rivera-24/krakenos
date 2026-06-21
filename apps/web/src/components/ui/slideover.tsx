import { X } from 'lucide-react';
import { useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { cn } from '@/lib/utils';

interface SlideoverProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Acciones primarias opcionales en el pie. */
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Panel que desliza desde la derecha (estilo UniFi) sin cambiar de ruta. Se
 * monta vía `createPortal` en `document.body` para no quedar recortado por el
 * `overflow`/`transform` de ningún ancestro. Se cierra con la X, con Escape o
 * haciendo clic en el backdrop.
 *
 * (El overlay usa posicionamiento de viewport, inevitable para una capa que
 * cubre la pantalla; el requisito clave es el portal, no el método de anclaje.)
 */
export function Slideover({
  open,
  onClose,
  title,
  subtitle,
  footer,
  children,
  className,
}: SlideoverProps) {
  const titleId = useId();
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
    <div className="fixed inset-0 z-50">
      {/* Backdrop sutil */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 right-0 flex w-full flex-col border-l border-kr bg-kr-surface shadow-xl outline-none md:w-[480px]',
          'motion-safe:animate-in motion-safe:slide-in-from-right motion-safe:duration-200',
          className,
        )}
      >
        <header className="flex items-start justify-between gap-3 border-b border-kr px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-kr-lg font-semibold text-kr-primary">
              {title}
            </h2>
            {subtitle && <div className="mt-0.5 text-kr-sm text-kr-secondary">{subtitle}</div>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-kr-secondary hover:bg-kr-elevated hover:text-kr-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer && <footer className="border-t border-kr px-5 py-4">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}
