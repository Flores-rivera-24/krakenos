import { HelpCircle } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

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
 * Desplazamiento horizontal (px) que mete la burbuja en `[margin, viewportWidth - margin]`.
 * 0 si ya cabe; si es más ancha que el hueco, se alinea a su izquierda.
 */
export function clampHintShift(
  rect: { left: number; right: number },
  viewportWidth: number,
  margin = 8,
): number {
  const hueco = viewportWidth - 2 * margin;
  if (rect.right - rect.left > hueco || rect.left < margin) return margin - rect.left;
  if (rect.right > viewportWidth - margin) return viewportWidth - margin - rect.right;
  return 0;
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
  label,
  children,
  placement = 'top',
  triggerClassName,
  className,
}: HelpHintProps) {
  const t = useT();
  const bubbleId = useId();
  const containerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
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

  // Al abrir: se mide la burbuja SIN desplazamiento adicional y se le aplica el ajuste que la
  // mete en la pantalla (a 320 px el `-translate-x-1/2` centrado la sacaba por un lado).
  useLayoutEffect(() => {
    const el = bubbleRef.current;
    if (!open || !el) return;
    el.style.setProperty('--hint-shift', '0px');
    const shift = clampHintShift(el.getBoundingClientRect(), document.documentElement.clientWidth);
    el.style.setProperty('--hint-shift', `${shift}px`);
  }, [open]);

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
        aria-label={children == null ? (label ?? t('ui.moreInfo')) : undefined}
        aria-expanded={open}
        aria-describedby={open ? bubbleId : undefined}
        onClick={() => setPinned((p) => !p)}
        className={cn(
          'inline-flex items-center gap-1 rounded-sm text-kr-secondary hover:text-kr-primary focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-kr-ring',
          // Solo el icono: con texto en línea (GlossaryTerm) el ::before de 44 px taparía las líneas vecinas.
          children == null && 'relative tap-target h-5 w-5 justify-center rounded-full',
          triggerClassName,
        )}
      >
        {children ?? <HelpCircle className="h-4 w-4" aria-hidden />}
      </button>
      {open && (
        <span
          ref={bubbleRef}
          id={bubbleId}
          role="tooltip"
          className={cn(
            'absolute left-1/2 z-50 w-max max-w-[min(20rem,calc(100vw-1rem))] translate-x-[calc(-50%+var(--hint-shift,0px))] rounded-md border border-kr bg-kr-elevated px-3 py-2 text-left text-kr-sm font-normal text-kr-primary shadow-lg',
            placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {content}
        </span>
      )}
    </span>
  );
}
