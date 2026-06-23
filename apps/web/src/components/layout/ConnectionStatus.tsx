import { StatusDot, type DotStatus } from '@/components/ui/status-dot';
import { cn } from '@/lib/utils';
import { useConnectionStore, type ConnectionStatus as Status } from '@/store/connection.store';

const UI: Record<Status, { dot: DotStatus; label: string }> = {
  connected: { dot: 'online', label: 'En tiempo real' },
  reconnecting: { dot: 'warning', label: 'Reconectando…' },
  offline: { dot: 'danger', label: 'Sin conexión' },
};

/**
 * Indicador honesto del estado del stream Socket.io en la sidebar (US-94), con el
 * mismo patrón que el estado del driver: punto de color + etiqueta. Refleja el
 * valor real de `connection.store` (no finge la reconexión).
 */
export function ConnectionStatus({ collapsed }: { collapsed: boolean }) {
  const status = useConnectionStore((s) => s.status);
  const ui = UI[status];
  return (
    <div
      className={cn('flex items-center gap-2', collapsed && 'justify-center')}
      title={collapsed ? ui.label : undefined}
    >
      <StatusDot status={ui.dot} label={ui.label} />
      {!collapsed && <span className="text-kr-xs text-kr-secondary">{ui.label}</span>}
    </div>
  );
}
