import type { IotDevice, RoomWithState } from '@krakenos/types';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RoomSelect } from '@/components/rooms/RoomSelect';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FavoriteButton } from '@/components/ui/favorite-button';
import { HelpHint } from '@/components/ui/help-hint';
import { OptimisticSwitch } from '@/components/ui/optimistic-switch';
import { assignRoom, listRooms } from '@/lib/rooms';
import { ProductArt, iotKindToArtKind } from '@/components/ui/product-art';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { StaleBadge } from '@/components/ui/stale-badge';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { getSocket } from '@/lib/socket';
import { cn } from '@/lib/utils';
import { toast } from '@/store/toast.store';
import { canControlHome } from '@/lib/roles';
import { useAuthStore } from '@/store/auth.store';
import { useConnectionStore } from '@/store/connection.store';
import { useFavoritesStore } from '@/store/favorites.store';
import { useT } from '@/lib/i18n';

function DeviceCard({
  device,
  isAdmin,
  canControl,
  rooms,
  roomId,
  onAssignRoom,
}: {
  device: IotDevice;
  isAdmin: boolean;
  canControl: boolean;
  rooms: RoomWithState[];
  roomId: string | null;
  onAssignRoom: (deviceId: string, roomId: string | null) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<number | null>(null);

  // El on/off va por `OptimisticSwitch`: se mueve ya y revierte si falla (US-96).
  // El brillo/color confirman con la lectura del socket (`iot:device-updated`);
  // si el PATCH falla se avisa con un toast y la UI sigue mostrando la verdad.
  const patch = (body: unknown) =>
    api.patch(`/iot/devices/${device.id}`, body).catch((err) => {
      toast.error(describeError(err, t('iot.applyError')));
    });

  const commitBrightness = () => {
    if (draft !== null) {
      void patch({ brightness: draft });
      setDraft(null);
    }
  };
  const commitColor = (hex: string) => void patch({ color: { hex } });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-kr-muted bg-kr-elevated',
              device.kind !== 'sensor' && !device.on && 'opacity-50',
            )}
          >
            <ProductArt kind={iotKindToArtKind(device.kind)} className="h-6 w-6" />
          </span>
          <CardTitle className="text-sm text-foreground">{device.name}</CardTitle>
        </div>
        <div className="flex items-center gap-1">
          <FavoriteButton kind="iot" ref_={device.id} label={device.name} />
          {device.kind !== 'sensor' && (
            <OptimisticSwitch
              checked={device.on ?? false}
              onToggle={(next) => api.patch(`/iot/devices/${device.id}`, { on: next })}
              disabled={!canControl}
              errorMessage={t('iot.toggleError', { name: device.name })}
              aria-label={t('iot.turnOn', { name: device.name })}
            />
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-2 text-xs text-muted-foreground">
          {device.room ?? t('iot.noRoom')}
        </p>

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
              <span>{t('iot.brightness')}</span>
              <span>{draft ?? device.brightness ?? 0}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={draft ?? device.brightness ?? 0}
              disabled={!canControl}
              aria-label={t('iot.brightnessOf', { name: device.name })}
              onChange={(e) => setDraft(Number(e.target.value))}
              onPointerUp={commitBrightness}
              onKeyUp={commitBrightness}
              className="w-full accent-primary disabled:opacity-50"
            />
          </div>
        )}

        {device.kind === 'light' && device.color !== null && (
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('iot.color')}</span>
            <input
              type="color"
              aria-label={t('iot.color')}
              value={device.color.hex ?? '#ffffff'}
              disabled={!canControl}
              onChange={(e) => commitColor(e.target.value)}
              className="h-6 w-10 cursor-pointer rounded border border-border bg-transparent disabled:opacity-50"
            />
          </div>
        )}

        {/* Asignación a habitación (US-165), admin-only. */}
        {isAdmin && rooms.length > 0 && (
          <div className="mt-3">
            <RoomSelect
              id={`iot-room-${device.id}`}
              rooms={rooms}
              value={roomId}
              onChange={(next) => onAssignRoom(device.id, next)}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function IotPage() {
  const t = useT();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  // Operar el hogar (toggle/brillo/color) también para `member` (US-179).
  const canControl = useAuthStore((s) => canControlHome(s.user?.role));
  const [devices, setDevices] = useState<Record<string, IotDevice>>({});
  const [rooms, setRooms] = useState<RoomWithState[]>([]);
  const [iotRoom, setIotRoom] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Deriva el mapa deviceId→roomId desde el estado agregado de las habitaciones.
  const buildRoomMap = (list: RoomWithState[]): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const room of list) {
      for (const id of room.iotDeviceIds) map[id] = room.id;
    }
    return map;
  };

  // Asigna un IoT a una habitación (optimista con reversión, US-96/US-165).
  const assignIotRoom = async (deviceId: string, roomId: string | null) => {
    const previous = iotRoom[deviceId] ?? null;
    setIotRoom((prev) => {
      const next = { ...prev };
      if (roomId) next[deviceId] = roomId;
      else delete next[deviceId];
      return next;
    });
    try {
      await assignRoom({ kind: 'iot', ref: deviceId, roomId });
      toast.success(t('iot.roomUpdated'));
    } catch (err) {
      setIotRoom((prev) => {
        const next = { ...prev };
        if (previous) next[deviceId] = previous;
        else delete next[deviceId];
        return next;
      });
      toast.error(describeError(err, t('iot.assignRoomError')));
    }
  };

  useEffect(() => {
    let active = true;
    const socket = getSocket();

    // Favoritos para que la estrella de cada tarjeta refleje el estado real (US-170).
    void useFavoritesStore.getState().load();

    // Habitaciones para el selector de asignación IoT (US-165, best-effort).
    void listRooms()
      .then((list) => {
        if (!active) return;
        setRooms(list);
        setIotRoom(buildRoomMap(list));
      })
      .catch(() => active && setRooms([]));

    void api
      .get<IotDevice[]>('/iot/devices')
      .then((list) => active && setDevices(Object.fromEntries(list.map((d) => [d.id, d]))))
      .catch(
        (err) => active && setError(describeError(err, t('iot.loadError'))),
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
          <div className="flex items-center gap-1.5">
            <h2 className="text-xl font-semibold">{t('iot.title')}</h2>
            <HelpHint content={t('iot.help')} label={t('iot.helpLabel')} />
          </div>
          <p className="text-sm text-muted-foreground">
            {isAdmin ? t('iot.subtitleAdmin') : t('iot.subtitleReadOnly')}
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
          <div className="flex flex-col items-center gap-3 rounded-xl border border-kr bg-kr-surface py-16 text-center">
            <p className="text-kr-secondary">{t('iot.emptyTitle')}</p>
            <p className="mx-auto max-w-md text-kr-sm text-kr-muted">{t('iot.emptyBody')}</p>
            <Link to="/connect" className={buttonVariants()}>
              {t('iot.emptyCta')}
            </Link>
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((d) => (
            <DeviceCard
              key={d.id}
              device={d}
              isAdmin={isAdmin}
              canControl={canControl}
              rooms={rooms}
              roomId={iotRoom[d.id] ?? null}
              onAssignRoom={(id, roomId) => void assignIotRoom(id, roomId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
