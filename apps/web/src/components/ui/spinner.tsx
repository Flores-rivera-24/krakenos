import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Spinner de carga (US-160). Anillo de acento que gira — el gesto de "trabajo en
 * curso" reutilizable para estados de datos (a nivel de página o de sección),
 * distinto del `Loader2` de los botones de mutación. Tokens kr-*, sin colores
 * hardcodeados. Respeta prefers-reduced-motion (motion-reduce:animate-none).
 *
 * Accesible: por defecto lleva `role="status"` + label en español para lectores
 * de pantalla; pásale `label=""` (o envuélvelo en algo con su propio texto) para
 * silenciarlo cuando el contexto ya anuncia la carga.
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
  const t = useT();
  const resolvedLabel = label ?? t('common.loading');
  const decorative = resolvedLabel === '';
  return (
    <span
      role={decorative ? undefined : 'status'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : resolvedLabel}
      className={cn(
        'inline-block shrink-0 animate-spin rounded-full border-kr-elevated border-t-kr-accent motion-reduce:animate-none',
        SIZES[size],
        className,
      )}
    />
  );
}
