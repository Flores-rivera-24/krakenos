import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

/**
 * Para estados de datos de página o sección; los botones de mutación usan `Loader2`.
 * Lleva `role="status"` salvo con `label=""`, que lo vuelve decorativo cuando el contexto ya anuncia la carga.
 * Respeta prefers-reduced-motion.
 */
export interface SpinnerProps {
  /** 16 / 20 / 28 / 40 px. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  /** Texto para lectores de pantalla. '' lo vuelve decorativo (`aria-hidden`). */
  label?: string;
}

const SIZES: Record<NonNullable<SpinnerProps['size']>, string> = {
  sm: 'h-4 w-4 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-7 w-7 border-[2.5px]',
  xl: 'h-10 w-10 border-[3px]',
};

export function Spinner({ size = 'md', className, label }: SpinnerProps) {
  // El texto por defecto se resuelve en el cuerpo: un hook no puede vivir en un
  // valor por defecto de parámetro (US-239).
  const t = useT();
  const texto = label ?? t('ui.loading');
  const decorative = label === '';
  return (
    <span
      role={decorative ? undefined : 'status'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : texto}
      className={cn(
        'inline-block shrink-0 animate-spin rounded-full border-kr-elevated border-t-kr-accent motion-reduce:animate-none',
        SIZES[size],
        className,
      )}
    />
  );
}
