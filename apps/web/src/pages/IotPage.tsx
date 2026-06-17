import type { IotDevice } from '@krakenos/types';
import { Lightbulb, PlugZap, Thermometer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';

const ICONS = { light: Lightbulb, plug: PlugZap, sensor: Thermometer } as const;

function DeviceCard({ device, isAdmin }: { device: IotDevice; isAdmin: boolean }) {
  const Icon = ICONS[device.kind];
  const [draft, setDraft] = useState<number | null>(null);

  const toggle = () => void api.patch(`/iot/devices/${device.id}`, { on: !device.on });
  const commitBrightness = () => {
    if (draft !== null) {
      void api.patch(`/iot/devices/${device.id}`, { brightness: draft });
      setDraft(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <Icon
            className={
              device.kind === 'sensor'
                ? 'h-4 w-4 text-primary'
                : device.on
                  ? 'h-4 w-4 text-amber-400'
                  : 'h-4 w-4 text-muted-foreground'
            }
          />
          <CardTitle className="text-sm text-foreground">{device.name}</CardTitle>
        </div>
        {device.kind !== 'sensor' && (
          <Switch checked={device.on ?? false} onCheckedChange={toggle} disabled={!isAdmin} />
        )}
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-muted-foreground">{device.room ?? 'Sin estancia'}</p>

        {device.kind === 'sensor' && device.reading && (
          <p className="text-2xl font-bold">
            {device.reading.value}
            <span className="ml-1 text-sm font-normal text-muted-foreground">
              {device.reading.unit}
            </span>
          </p>
        )}

        {device.kind === 'light' && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Brillo</span>
              <span>{draft ?? device.brightness ?? 0}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={draft ?? device.brightness ?? 0}
              disabled={!isAdmin}
              onChange={(e) => setDraft(Number(e.target.value))}
              onPointerUp={commitBrightness}
              onKeyUp={commitBrightness}
              className="w-full accent-primary disabled:opacity-50"
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function IotPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [devices, setDevices] = useState<Record<string, IotDevice>>({});

  useEffect(() => {
    let active = true;
    const socket = getSocket();

    void api
      .get<IotDevice[]>('/iot/devices')
      .then((list) => active && setDevices(Object.fromEntries(list.map((d) => [d.id, d]))))
      .catch(() => undefined);

    const onSnapshot = (list: IotDevice[]) =>
      setDevices(Object.fromEntries(list.map((d) => [d.id, d])));
    const onUpdated = (d: IotDevice) => setDevices((prev) => ({ ...prev, [d.id]: d }));

    socket.on('iot:snapshot', onSnapshot);
    socket.on('iot:device-updated', onUpdated);
    return () => {
      active = false;
      socket.off('iot:snapshot', onSnapshot);
      socket.off('iot:device-updated', onUpdated);
    };
  }, []);

  const list = useMemo(() => Object.values(devices), [devices]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">Dispositivos IoT</h2>
        <p className="text-sm text-muted-foreground">
          {isAdmin ? 'Controla luces, enchufes y sensores.' : 'Solo lectura — requiere rol admin.'}
        </p>
      </div>

      {list.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Sin dispositivos IoT.</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((d) => (
            <DeviceCard key={d.id} device={d} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  );
}
