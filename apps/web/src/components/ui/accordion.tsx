import { ChevronDown } from 'lucide-react';
import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface AccordionContextValue {
  isOpen: (id: string) => boolean;
  toggle: (id: string) => void;
}

const AccordionContext = createContext<AccordionContextValue | null>(null);

export interface AccordionProps {
  /** "single": una sola sección abierta a la vez. "multiple": varias. Por defecto "single". */
  type?: 'single' | 'multiple';
  /** Ids de las secciones abiertas al montar (no controlado). */
  defaultOpen?: string[];
  children: ReactNode;
  className?: string;
}

/**
 * Contenedor de secciones colapsables (troubleshooting/FAQ). Gestiona qué
 * secciones están abiertas; con `type="single"` cierra las demás al abrir una.
 * Cada sección es un `AccordionItem` con su `id`.
 */
export function Accordion({
  type = 'single',
  defaultOpen = [],
  children,
  className,
}: AccordionProps) {
  const [openIds, setOpenIds] = useState<string[]>(defaultOpen);

  const isOpen = (id: string) => openIds.includes(id);
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const already = prev.includes(id);
      if (type === 'single') return already ? [] : [id];
      return already ? prev.filter((x) => x !== id) : [...prev, id];
    });

  return (
    <AccordionContext.Provider value={{ isOpen, toggle }}>
      <div className={cn('overflow-hidden rounded-lg border border-kr', className)}>{children}</div>
    </AccordionContext.Provider>
  );
}

export interface AccordionItemProps {
  /** Identificador único de la sección dentro del acordeón. */
  id: string;
  /** Encabezado clicable de la sección. */
  title: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Sección colapsable de un `Accordion`. El encabezado es un `<button>` con
 * `aria-expanded`/`aria-controls`; el panel es una `region` etiquetada por el
 * botón y se oculta con `hidden` cuando está cerrado.
 */
export function AccordionItem({ id, title, children, className }: AccordionItemProps) {
  const ctx = useContext(AccordionContext);
  if (!ctx) throw new Error('AccordionItem debe usarse dentro de <Accordion>');

  const headerId = useId();
  const panelId = useId();
  const open = ctx.isOpen(id);

  return (
    <div className={cn('border-b border-kr last:border-b-0', className)}>
      <button
        type="button"
        id={headerId}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => ctx.toggle(id)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-kr-base font-medium text-kr-primary hover:bg-kr-elevated focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="min-w-0">{title}</span>
        <ChevronDown
          className={cn(
            'h-5 w-5 shrink-0 text-kr-secondary transition-transform',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>
      <div
        id={panelId}
        role="region"
        aria-labelledby={headerId}
        hidden={!open}
        className="px-4 pb-4 text-kr-sm text-kr-secondary"
      >
        {children}
      </div>
    </div>
  );
}
