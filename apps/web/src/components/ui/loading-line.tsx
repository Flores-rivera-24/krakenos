import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { useT } from '@/lib/i18n';

/** `role="status"` anuncia la carga; el spinner es decorativo porque el texto ya informa. */
export function LoadingLine({ label, className }: { label?: string; className?: string }) {
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
      <span>{label ?? t('ui.loading')}</span>
    </div>
  );
}
