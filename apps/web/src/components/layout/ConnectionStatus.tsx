import { StatusDot, type DotStatus } from '@/components/ui/status-dot';
import { useT, type TranslationKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useConnectionStore, type ConnectionStatus as Status } from '@/store/connection.store';

const UI: Record<Status, { dot: DotStatus; label: TranslationKey }> = {
  connected: { dot: 'online', label: 'connection.live' },
  reconnecting: { dot: 'warning', label: 'connection.reconnecting' },
  offline: { dot: 'danger', label: 'connection.offline' },
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
  const label = t(ui.label);
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
