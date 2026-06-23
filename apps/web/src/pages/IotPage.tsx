import type { IotDevice } from '@krakenos/types';
import { Lightbulb, PlugZap, Thermometer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { StaleBadge } from '@/components/ui/stale-badge';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';
import { useConnectionStore } from '@/store/connection.store';

const ICONS = { light: Lightbulb, plug: PlugZap, sensor: Thermometer } as const;

function DeviceCard({
  device,
  isAdmin,
  onError,
}: {
  device: IotDevice;
  isAdmin: boolean;
  onError: (err: unknown) => void;
}) {
  const Icon = ICONS[device.kind];
  const [draft, setDraft] = useState<number | null>(null);

  // El estado real lo refleja el socket (`iot:device-updated`), así que no hay
  // estado optimista que revertir: si el PATCH falla, la UI ya muestra el valor
  // del servidor; basta con avisar del fallo (US-93).
  const patch = (body: unknown) => void api.patch(`/iot/devices/${device.id}`, body).catch(onError);

  const toggle = () => patch({ on: !device.on });
  const commitBrightness = () => {
    if (draft !== null) {
      patch({ brightness: draft });
      setDraft(null);
    }
  };
  const commitColor = (hex: string) => patch({ color: { hex } });

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
          <Switch
            checked={device.on ?? false}
            onCheckedChange={toggle}
            disabled={!isAdmin}
            aria-label={`Encender ${device.name}`}
          />
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
              aria-label={`Brillo de ${device.name}`}
              onChange={(e) => setDraft(Number(e.target.value))}
              onPointerUp={commitBrightness}
              onKeyUp={commitBrightness}
              className="w-full accent-primary disabled:opacity-50"
            />
          </div>
        )}

        {device.kind === 'light' && device.color !== null && (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Color</span>
            <input
              type="color"
              aria-label="Color"
              value={device.color.hex ?? '#ffffff'}
              disabled={!isAdmin}
              onChange={(e) => commitColor(e.target.value)}
              className="h-6 w-10 cursor-pointer rounded border border-border bg-transparent disabled:opacity-50"
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const socket = getSocket();

    void api
      .get<IotDevice[]>('/iot/devices')
      .then((list) => active && setDevices(Object.fromEntries(list.map((d) => [d.id, d]))))
      .catch(
        (err) => active && setError(describeError(err, 'No se pudieron cargar los dispositivos')),
      )
      .finally(() => active && setLoading(false));

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
  // Stream caído/reconectando: los estados mostrados pueden estar congelados (US-94).
  const stale = useConnectionStore((s) => s.status) !== 'connected';

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Dispositivos IoT</h2>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? 'Controla luces, enchufes y sensores.'
              : 'Solo lectura — requiere rol admin.'}
          </p>
        </div>
        {stale && list.length > 0 && <StaleBadge className="mt-1" />}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-36 w-full rounded-xl" />
          ))}
        </div>
      ) : list.length === 0 ? (
        !error && (
          <p className="py-12 text-center text-sm text-kr-muted">Aún no hay dispositivos IoT.</p>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              isAdmin={isAdmin}
              onError={(e) => setError(describeError(e, 'No se pudo aplicar el cambio'))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
