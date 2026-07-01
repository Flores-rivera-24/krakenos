import { HelpCircle } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface HelpHintProps {
  /** Explicación en lenguaje sencillo que revela la burbuja. */
  content: ReactNode;
  /** Etiqueta accesible del disparador cuando no hay `children`. Por defecto "Más información". */
  label?: string;
  /** Disparador personalizado. Si se omite, se usa un icono de interrogación. */
  children?: ReactNode;
  /** Lado donde aparece la burbuja respecto al disparador. Por defecto "top". */
  placement?: 'top' | 'bottom';
  /** Clases extra para el botón disparador (p. ej. para envolver texto inline). */
  triggerClassName?: string;
  className?: string;
}

/**
 * Pista de ayuda accesible (tooltip/popover ligero, sin librería de posición).
 * Se abre al pasar el ratón, al enfocar con teclado y al hacer clic; se cierra
 * con Escape, al perder el foco o al hacer clic fuera. La burbuja (`role="tooltip"`)
 * se asocia al disparador vía `aria-describedby` mientras está abierta, y el
 * disparador refleja el estado con `aria-expanded`.
 */
export function HelpHint({
  content,
  label = 'Más información',
  children,
  placement = 'top',
  triggerClassName,
  className,
}: HelpHintProps) {
  const bubbleId = useId();
  const containerRef = useRef<HTMLSpanElement>(null);
  // El estado se deriva de tres fuentes independientes: ratón, foco y clic
  // fijado. Así, salir con el ratón no cierra si sigue enfocado, y al revés.
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const open = hover || focus || pinned;

  const closeAll = () => {
    setHover(false);
    setFocus(false);
    setPinned(false);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setPinned(false);
        setHover(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open]);

  return (
    <span
      ref={containerRef}
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={(e) => {
        // Solo cierra si el foco sale del componente por completo.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
      }}
    >
      <button
        type="button"
        aria-label={children == null ? label : undefined}
        aria-expanded={open}
        aria-describedby={open ? bubbleId : undefined}
        onClick={() => setPinned((p) => !p)}
        className={cn(
          'inline-flex items-center gap-1 rounded text-kr-secondary hover:text-kr-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          children == null && 'h-5 w-5 justify-center rounded-full',
          triggerClassName,
        )}
      >
        {children ?? <HelpCircle className="h-4 w-4" aria-hidden />}
      </button>
      {open && (
        <span
          id={bubbleId}
          role="tooltip"
          className={cn(
            'absolute left-1/2 z-50 w-max max-w-xs -translate-x-1/2 rounded-md border border-kr bg-kr-elevated px-3 py-2 text-left text-kr-sm font-normal text-kr-primary shadow-lg',
            placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
