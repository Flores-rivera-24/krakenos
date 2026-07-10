import type { Device, Favorite, IotDevice, RoomWithState, Scene } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { OptimisticSwitch } from '@/components/ui/optimistic-switch';
import { StatusDot } from '@/components/ui/status-dot';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { roomGlyph } from '@/lib/rooms';
import { runScene, sceneGlyph } from '@/lib/scenes';
import { getSocket } from '@/lib/socket';
import { canControlHome } from '@/lib/roles';
import { useAuthStore } from '@/store/auth.store';
import { useFavoritesStore } from '@/store/favorites.store';
import { toast } from '@/store/toast.store';

/** Un favorito resuelto contra el estado vivo, listo para pintar el tile. */
interface ResolvedTile {
  key: string;
  label: string;
  glyph: string;
  /** Si es un IoT controlable, su estado on + acción de toggle. */
  iot?: { id: string; on: boolean };
  /** Si es una escena, su id para ejecutarla de un toque. */
  sceneId?: string;
  /** Destino del enlace (ir a la sección relevante). */
  to: string;
  online: boolean;
}

function resolveTiles(
  favorites: Favorite[],
  iot: Map<string, IotDevice>,
  devices: Map<string, Device>,
  rooms: Map<string, RoomWithState>,
  scenes: Map<string, Scene>,
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
    } else if (fav.kind === 'scene') {
      const s = scenes.get(fav.ref);
      if (!s) continue;
      tiles.push({
        key: fav.id,
        label: s.name,
        glyph: sceneGlyph(s.icon),
        sceneId: s.id,
        to: '/scenes',
        online: true,
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
  const t = useT();
  // Operar lo cotidiano también para `member` (US-179); la autoridad es del servidor.
  const canControl = useAuthStore((s) => canControlHome(s.user?.role));
  const favorites = useFavoritesStore((s) => s.favorites);
  const loadFavorites = useFavoritesStore((s) => s.load);
  const [iot, setIot] = useState<Map<string, IotDevice>>(new Map());
  const [devices, setDevices] = useState<Map<string, Device>>(new Map());
  const [rooms, setRooms] = useState<Map<string, RoomWithState>>(new Map());
  const [scenes, setScenes] = useState<Map<string, Scene>>(new Map());
  const [loading, setLoading] = useState(true);
  const [runningScene, setRunningScene] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const byId = <T,>(list: T[], key: (t: T) => string) => new Map(list.map((t) => [key(t), t]));

    void Promise.all([
      loadFavorites(),
      api.get<IotDevice[]>('/iot/devices').catch(() => [] as IotDevice[]),
      api.get<Device[]>('/inventory/devices').catch(() => [] as Device[]),
      api.get<RoomWithState[]>('/rooms').catch(() => [] as RoomWithState[]),
      api.get<Scene[]>('/scenes').catch(() => [] as Scene[]),
    ])
      .then(([, iotList, devList, roomList, sceneList]) => {
        if (!active) return;
        setIot(byId(iotList, (d) => d.id));
        setDevices(byId(devList, (d) => d.id));
        setRooms(byId(roomList, (r) => r.id));
        setScenes(byId(sceneList, (s) => s.id));
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

  const runFavoriteScene = async (id: string, name: string) => {
    setRunningScene(id);
    try {
      const result = await runScene(id);
      if (result.failed.length > 0)
        toast.error(
          t('dashboard.scene.partial', { applied: result.applied, failed: result.failed.length }),
        );
      else toast.success(t('dashboard.scene.activated', { name }));
    } catch (err) {
      toast.error(describeError(err, t('dashboard.scene.activateError')));
    } finally {
      setRunningScene(null);
    }
  };

  const tiles = resolveTiles(favorites, iot, devices, rooms, scenes);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t('dashboard.widget.quickActions.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingLine />
        ) : tiles.length === 0 ? (
          <p className="py-4 text-center text-kr-sm text-kr-muted">
            {t('dashboard.widget.quickActions.empty')}
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
                      {tile.online
                        ? t('dashboard.widget.quickActions.available')
                        : t('dashboard.widget.quickActions.noSignal')}
                    </span>
                  </span>
                </Link>
                {tile.iot && (
                  <OptimisticSwitch
                    checked={tile.iot.on}
                    onToggle={(next) => api.patch(`/iot/devices/${tile.iot!.id}`, { on: next })}
                    disabled={!canControl}
                    errorMessage={t('dashboard.widget.quickActions.toggleError', {
                      name: tile.label,
                    })}
                    aria-label={
                      tile.iot.on
                        ? t('dashboard.widget.quickActions.turnOff', { name: tile.label })
                        : t('dashboard.widget.quickActions.turnOn', { name: tile.label })
                    }
                  />
                )}
                {tile.sceneId && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canControl || runningScene === tile.sceneId}
                    onClick={() => void runFavoriteScene(tile.sceneId!, tile.label)}
                  >
                    {runningScene === tile.sceneId
                      ? t('dashboard.scene.activating')
                      : t('dashboard.scene.activate')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
