import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusDot } from '@/components/ui/status-dot';
import { useInventoryStore } from '@/store/inventory.store';

function Stat({
  status,
  label,
  value,
}: {
  status: 'online' | 'offline' | 'warning' | 'danger';
  label: string;
  value: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <StatusDot status={status} />
      <span className="text-kr-2xl font-semibold text-kr-primary">{value}</span>
      <span className="text-kr-sm text-kr-secondary">{label}</span>
    </div>
  );
}

/** Contadores de dispositivos: online / total / desconocidos / bloqueados. */
export function DeviceCountWidget() {
  const devices = useInventoryStore((s) => Object.values(s.devices));
  const online = devices.filter((d) => d.online).length;
  const unknown = devices.filter((d) => d.type === 'unknown').length;
  const blocked = devices.filter((d) => d.isBlocked).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Dispositivos</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3">
        <Stat status="online" label="online" value={online} />
        <Stat status="offline" label="total" value={devices.length} />
        <Stat status="warning" label="desconocidos" value={unknown} />
        <Stat status="danger" label="bloqueados" value={blocked} />
        <Link to="/inventory" className="col-span-2 text-kr-sm text-kr-accent hover:underline">
          Ver inventario →
        </Link>
      </CardContent>
    </Card>
  );
}
