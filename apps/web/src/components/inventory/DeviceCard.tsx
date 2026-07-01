import type { Device, DeviceType } from '@krakenos/types';
import {
  Cpu,
  HelpCircle,
  Laptop,
  Printer,
  Router,
  Smartphone,
  Tablet,
  Tv,
  type LucideIcon,
} from 'lucide-react';
import { StatusDot } from '@/components/ui/status-dot';
import { TYPE_LABELS } from '@/lib/devices';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Icono lucide (24px en la card) por tipo de dispositivo. */
const TYPE_ICONS: Record<DeviceType, LucideIcon> = {
  router: Router,
  computer: Laptop,
  phone: Smartphone,
  tablet: Tablet,
  iot: Cpu,
  tv: Tv,
  printer: Printer,
  unknown: HelpCircle,
};

interface Props {
  device: Device;
  onSelect: (id: string) => void;
}

/**
 * Card de dispositivo estilo UniFi (US-43): icono del tipo, nombre, IP, tipo legible y
 * fila inferior con estado + última vez visto. Click → abre el slideover de detalle.
 */
export function DeviceCard({ device, onSelect }: Props) {
  const Icon = TYPE_ICONS[device.type];
  const name = device.label ?? device.hostname ?? device.mac;
  const blocked = device.isBlocked;
  const dotStatus = blocked ? 'danger' : device.online ? 'online' : 'offline';
  const statusText = blocked ? 'Bloqueado' : device.online ? 'En línea' : 'Desconectado';

  return (
    <button
      type="button"
      onClick={() => onSelect(device.id)}
      className="flex w-full cursor-pointer flex-col gap-3 rounded-xl border border-kr bg-kr-surface p-4 text-left transition-colors duration-150 hover:border-kr-accent"
    >
      <div className="flex items-start gap-3">
        <Icon className="h-6 w-6 shrink-0 text-kr-secondary" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-kr-primary">{name}</p>
          <p className="text-kr-sm text-kr-secondary">{device.ip}</p>
          <p className="text-kr-xs text-kr-muted">{TYPE_LABELS[device.type]}</p>
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
