import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
}

export interface SegmentedControlProps<T extends string | number> {
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  'aria-label': string;
  className?: string;
}

/** Elegir una opción entre pocas: botones con `aria-pressed` dentro de un grupo con nombre. */
export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  'aria-label': ariaLabel,
  className,
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex items-center gap-1 rounded-md border border-kr p-0.5', className)}
    >
      {options.map((o) => {
        const activo = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={activo}
            onClick={() => {
              if (!activo) onChange(o.value);
            }}
            className={cn(
              'min-h-11 min-w-11 rounded-sm px-3 text-kr-sm transition-colors md:h-8 md:min-h-0 md:min-w-0',
              activo
                ? 'bg-kr-accent text-white'
                : 'text-kr-secondary hover:bg-kr-elevated hover:text-kr-primary',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
