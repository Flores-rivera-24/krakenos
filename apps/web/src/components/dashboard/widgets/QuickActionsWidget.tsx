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
import {
  useInventoryDevices,
  useIotDevices,
  useRooms,
  useScenes,
} from '@/lib/resources';
import { roomGlyph } from '@/lib/rooms';
import { runScene, sceneGlyph } from '@/lib/scenes';
import { getSocket } from '@/lib/socket';
import { canControlHome } from '@/lib/roles';
import { useAuthStore } from '@/store/auth.store';
import { useFavoritesStore } from '@/store/favorites.store';
import { toast } from '@/store/toast.store';
import { useT } from '@/lib/i18n';

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
  const [runningScene, setRunningScene] = useState<string | null>(null);

  // US-262: las cuatro listas se comparten con otros widgets (`/iot/devices` con
  // `IotStatusWidget` y la barra lateral, `/scenes` con `ScenesWidget`). Antes
  // este `Promise.all` las pedía por su cuenta, así que abrir el dashboard las
  // pedía dos y tres veces en el mismo tick.
  const iotRes = useIotDevices();
  const devicesRes = useInventoryDevices();
  const roomsRes = useRooms();
  const scenesRes = useScenes();

  useEffect(() => {
    void loadFavorites();
  }, [loadFavorites]);

  /**
   * Estado IoT llegado por socket desde el último render (US-94: encender un foco
   * desde el interruptor de pared se ve sin recargar).
   *
   * Se guarda **aparte** de la lista compartida y se superpone al pintar, en vez
   * de escribir dentro de la caché: la caché la comparten tres consumidores, y un
   * widget que la mutara estaría decidiendo por los otros dos. Al releer la lista,
   * el dato del servidor vuelve a mandar sobre las superposiciones ya reflejadas.
   */
  const [enVivo, setEnVivo] = useState<Map<string, IotDevice>>(new Map());

  useEffect(() => {
    const socket = getSocket();
    const onUpdated = (d: IotDevice) => setEnVivo((prev) => new Map(prev).set(d.id, d));
    socket.on('iot:device-updated', onUpdated);
    return () => {
      socket.off('iot:device-updated', onUpdated);
    };
  }, []);

  const byId = <T,>(list: T[] | null, key: (t: T) => string) =>
    new Map((list ?? []).map((t) => [key(t), t]));

  const iot = byId(iotRes.data, (d) => d.id);
  for (const [id, d] of enVivo) iot.set(id, d);
  const devices = byId(devicesRes.data, (d) => d.id);
  const rooms = byId(roomsRes.data, (r) => r.id);
  const scenes = byId(scenesRes.data, (s) => s.id);

  /**
   * Se deja de esperar cuando cada lectura ha **terminado**, con dato o con fallo.
   * Mirar solo `data !== null` dejaría el esqueleto puesto para siempre si una de
   * las cuatro falla — que es peor que el vacío honesto que ya se pinta debajo.
   */
  const asentada = (r: { data: unknown; error: unknown }) => r.data !== null || r.error !== null;
  const loading = ![iotRes, devicesRes, roomsRes, scenesRes].every(asentada);

  const runFavoriteScene = async (id: string, name: string) => {
    setRunningScene(id);
    try {
      const result = await runScene(id);
      if (result.failed.length > 0)
        toast.error(t('scenes.partial', { applied: result.applied, failed: result.failed.length }));
      else toast.success(t('scenes.ran', { name }));
    } catch (err) {
      toast.error(describeError(err, t('widget.scenes.runFailed')));
    } finally {
      setRunningScene(null);
    }
  };

  const tiles = resolveTiles(favorites, iot, devices, rooms, scenes);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t('widget.quickActions.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <LoadingLine />
        ) : tiles.length === 0 ? (
          <p className="py-4 text-center text-kr-sm text-kr-muted">
            {t('widget.quickActions.empty')}
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
                    disabled={!canControl}
                    errorMessage={t('widget.quickActions.toggleFailed', { name: tile.label })}
                    aria-label={t('widget.quickActions.toggle', {
                      action: tile.iot.on ? t('widget.toggle.off') : t('widget.toggle.on'),
                      name: tile.label,
                    })}
                  />
                )}
                {tile.sceneId && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canControl || runningScene === tile.sceneId}
                    onClick={() => void runFavoriteScene(tile.sceneId!, tile.label)}
                  >
                    {runningScene === tile.sceneId ? t('widget.scenes.running') : t('widget.scenes.run')}
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
