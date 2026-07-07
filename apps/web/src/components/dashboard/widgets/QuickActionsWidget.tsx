import type { Device, Favorite, IotDevice, RoomWithState } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { OptimisticSwitch } from '@/components/ui/optimistic-switch';
import { StatusDot } from '@/components/ui/status-dot';
import { api } from '@/lib/api';
import { roomGlyph } from '@/lib/rooms';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';
import { useFavoritesStore } from '@/store/favorites.store';

/** Un favorito resuelto contra el estado vivo, listo para pintar el tile. */
interface ResolvedTile {
  key: string;
  label: string;
  glyph: string;
  /** Si es un IoT controlable, su estado on + acción de toggle. */
  iot?: { id: string; on: boolean };
  /** Destino del enlace (ir a la sección relevante). */
  to: string;
  online: boolean;
}

function resolveTiles(
  favorites: Favorite[],
  iot: Map<string, IotDevice>,
  devices: Map<string, Device>,
  rooms: Map<string, RoomWithState>,
): ResolvedTile[] {
  const tiles: ResolvedTile[] = [];
  for (const fav of favorites) {
    if (fav.kind === 'iot') {
      const d = iot.get(fav.ref);
      if (!d) continue;
      tiles.push({
        key: fav.id,
        label: d.name,
        glyph: d.kind === 'plug' ? '🔌' : d.kind === 'sensor' ? '🌡️' : '💡',
        iot: d.on !== null ? { id: d.id, on: d.on } : undefined,
        to: '/iot',
        online: d.reachable,
      });
    } else if (fav.kind === 'device') {
      const d = devices.get(fav.ref);
      if (!d) continue;
      tiles.push({
        key: fav.id,
        label: d.label ?? d.hostname ?? d.mac,
        glyph: '🖥️',
        to: '/inventory',
        online: d.online,
      });
    } else if (fav.kind === 'room') {
      const r = rooms.get(fav.ref);
      if (!r) continue;
      tiles.push({
        key: fav.id,
        label: r.name,
        glyph: roomGlyph(r.icon),
        to: '/rooms',
        online: !r.anyUnreachable,
      });
    }
  }
  return tiles;
}

/**
 * Acciones rápidas (US-170): los favoritos del usuario con estado en vivo y
 * toggle optimista para los IoT. Se coloca el primero en el dashboard (primero
 * en móvil) para operar lo cotidiano en un toque.
 */
export function QuickActionsWidget() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const favorites = useFavoritesStore((s) => s.favorites);
  const loadFavorites = useFavoritesStore((s) => s.load);
  const [iot, setIot] = useState<Map<string, IotDevice>>(new Map());
  const [devices, setDevices] = useState<Map<string, Device>>(new Map());
  const [rooms, setRooms] = useState<Map<string, RoomWithState>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const byId = <T extends { id?: string; mac?: string }>(list: T[], key: (t: T) => string) =>
      new Map(list.map((t) => [key(t), t]));

    void Promise.all([
      loadFavorites(),
      api.get<IotDevice[]>('/iot/devices').catch(() => [] as IotDevice[]),
      api.get<Device[]>('/inventory/devices').catch(() => [] as Device[]),
      api.get<RoomWithState[]>('/rooms').catch(() => [] as RoomWithState[]),
    ])
      .then(([, iotList, devList, roomList]) => {
        if (!active) return;
        setIot(byId(iotList, (d) => d.id));
        setDevices(byId(devList, (d) => d.id));
        setRooms(byId(roomList, (r) => r.id));
      })
      .finally(() => active && setLoading(false));

    // Estado IoT en vivo: refleja los cambios sin recargar (US-94).
    const socket = getSocket();
    const onUpdated = (d: IotDevice) => setIot((prev) => new Map(prev).set(d.id, d));
    socket.on('iot:device-updated', onUpdated);
    return () => {
      active = false;
      socket.off('iot:device-updated', onUpdated);
    };
  }, [loadFavorites]);

  const tiles = resolveTiles(favorites, iot, devices, rooms);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Acciones rápidas</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingLine />
        ) : tiles.length === 0 ? (
          <p className="py-4 text-center text-kr-sm text-kr-muted">
            Fija tus dispositivos y habitaciones favoritos con la estrella ⭐ para tenerlos aquí.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {tiles.map((tile) => (
              <li
                key={tile.key}
                className="flex min-h-[3rem] items-center justify-between gap-2 rounded-lg border border-kr bg-kr-elevated px-3 py-2"
              >
                <Link to={tile.to} className="flex min-w-0 items-center gap-2">
                  <span aria-hidden className="text-xl">
                    {tile.glyph}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-kr-sm text-kr-primary">{tile.label}</span>
                    <span className="flex items-center gap-1 text-kr-xs text-kr-muted">
                      <StatusDot status={tile.online ? 'online' : 'offline'} />
                      {tile.online ? 'disponible' : 'sin señal'}
                    </span>
                  </span>
                </Link>
                {tile.iot && (
                  <OptimisticSwitch
                    checked={tile.iot.on}
                    onToggle={(next) => api.patch(`/iot/devices/${tile.iot!.id}`, { on: next })}
                    disabled={!isAdmin}
                    errorMessage={`No se pudo cambiar ${tile.label}`}
                    aria-label={`Encender ${tile.label}`}
                  />
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
