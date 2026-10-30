import { forwardRef } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ToggleChipProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'type'
> {
  pressed: boolean;
  onPressedChange: (next: boolean) => void;
  /** `pill` para filtros y categorías; `day` para la casilla cuadrada de un día de la semana. */
  shape?: 'pill' | 'day';
}

/** Una opción que se marca o se desmarca sin afectar a las demás: `aria-pressed`, nunca `radio`. */
export const ToggleChip = forwardRef<HTMLButtonElement, ToggleChipProps>(function ToggleChip(
  { pressed, onPressedChange, shape = 'pill', className, onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={pressed}
      onClick={(e) => {
        onClick?.(e);
        onPressedChange(!pressed);
      }}
      className={cn(
        'inline-flex min-h-11 items-center justify-center border transition-colors md:min-h-0',
        shape === 'day'
          ? 'h-11 w-11 rounded-md text-kr-xs md:h-9 md:w-9'
          : 'rounded-full px-3 text-kr-sm md:h-8',
        pressed
          ? 'border-kr-accent bg-kr-accent-faint text-kr-primary'
          : 'border-kr bg-kr-elevated text-kr-muted hover:text-kr-primary',
        className,
      )}
      {...rest}
    />
  );
});

export interface ToggleChipGroupProps {
  'aria-label': string;
  children: ReactNode;
  className?: string;
}

/** Agrupa varios `ToggleChip` bajo un nombre accesible. */
export function ToggleChipGroup({ children, className, ...rest }: ToggleChipGroupProps) {
  return (
    <div
      role="group"
      aria-label={rest['aria-label']}
      className={cn('flex flex-wrap gap-1', className)}
    >
      {children}
    </div>
  );
}
