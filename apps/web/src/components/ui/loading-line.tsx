import { Spinner } from '@/components/ui/spinner';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Línea de carga compacta (US-162): un spinner de acento + texto, centrada. Unifica
 * el "Cargando…" plano de los widgets del dashboard y otros paneles pequeños. El
 * `role="status"` la anuncia; el spinner queda decorativo (el texto ya informa).
 */
export function LoadingLine({
  label,
  className,
}: {
  label?: string;
  className?: string;
}) {
  const t = useT();
  return (
    <div
      role="status"
      className={cn(
        'flex items-center justify-center gap-2 py-6 text-kr-sm text-kr-muted',
        className,
      )}
    >
      <Spinner size="sm" label="" />
      <span>{label ?? t('common.loading')}</span>
    </div>
  );
}
