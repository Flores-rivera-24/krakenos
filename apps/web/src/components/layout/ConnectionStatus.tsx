import { StatusDot, type DotStatus } from '@/components/ui/status-dot';
import { useT, type TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useConnectionStore, type ConnectionStatus as Status } from '@/store/connection.store';

const UI: Record<Status, { dot: DotStatus; labelKey: TranslationKey }> = {
  connected: { dot: 'online', labelKey: 'connection.realtime' },
  reconnecting: { dot: 'warning', labelKey: 'connection.reconnecting' },
  offline: { dot: 'danger', labelKey: 'connection.offline' },
};

/**
 * Indicador honesto del estado del stream Socket.io en la sidebar (US-94), con el
 * mismo patrón que el estado del driver: punto de color + etiqueta. Refleja el
 * valor real de `connection.store` (no finge la reconexión).
 */
export function ConnectionStatus({ collapsed }: { collapsed: boolean }) {
  const t = useT();
  const status = useConnectionStore((s) => s.status);
  const ui = UI[status];
  const label = t(ui.labelKey);
  return (
    <div
      className={cn('flex items-center gap-2', collapsed && 'justify-center')}
      title={collapsed ? label : undefined}
    >
      <StatusDot status={ui.dot} label={label} />
      {!collapsed && <span className="text-kr-xs text-kr-secondary">{label}</span>}
    </div>
  );
}
