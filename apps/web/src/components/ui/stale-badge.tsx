import { StatusDot } from '@/components/ui/status-dot';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Marca un panel en tiempo real como "obsoleto" cuando el stream está caído o las
 * muestras dejaron de llegar (US-94): así no se presentan valores congelados como
 * si fueran actuales. Tokens kr-*.
 */
export function StaleBadge({ className }: { className?: string }) {
  const t = useT();
  const etiqueta = t('staleBadge.label');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border border-warning bg-kr-elevated px-2 py-0.5 text-kr-xs font-medium text-warning',
        className,
      )}
      title={t('staleBadge.title')}
    >
      <StatusDot status="warning" label={etiqueta} />
      {etiqueta}
    </span>
  );
}
