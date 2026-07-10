import type { Device } from '@krakenos/types';
import { ProductArt } from '@/components/ui/product-art';
import { StatusDot } from '@/components/ui/status-dot';
import { TYPE_LABELS, deviceArtKind } from '@/lib/devices';
import { timeAgo } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface Props {
  device: Device;
  onSelect: (id: string) => void;
}

/**
 * Card de dispositivo estilo UniFi (US-43): render del producto por tipo (US-161),
 * nombre, IP, tipo legible y fila inferior con estado + última vez visto. Click →
 * abre el slideover de detalle.
 */
export function DeviceCard({ device, onSelect }: Props) {
  const t = useT();
  const name = device.label ?? device.hostname ?? device.mac;
  const blocked = device.isBlocked;
  const dotStatus = blocked ? 'danger' : device.online ? 'online' : 'offline';
  const statusText = blocked
    ? t('inventory.status.blocked')
    : device.online
      ? t('inventory.status.online')
      : t('inventory.status.offline');

  return (
    <button
      type="button"
      onClick={() => onSelect(device.id)}
      className="group flex w-full cursor-pointer flex-col gap-3 rounded-xl border border-kr bg-kr-surface p-4 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-kr-accent hover:shadow-kr-glow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-kr-muted bg-kr-elevated transition-colors group-hover:border-kr-accent-glow">
          <ProductArt kind={deviceArtKind(device)} className="h-9 w-9" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-kr-primary">{name}</p>
          <p className="text-kr-sm text-kr-secondary">{device.ip}</p>
          <p className="text-kr-xs text-kr-muted">{t(TYPE_LABELS[device.type])}</p>
        </div>
      </div>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          <StatusDot status={dotStatus} />
          <span className={cn('text-kr-sm', blocked ? 'text-danger' : 'text-kr-secondary')}>
            {statusText}
          </span>
        </span>
        <span className="text-kr-xs text-kr-muted">{timeAgo(device.lastSeen)}</span>
      </div>
    </button>
  );
}
