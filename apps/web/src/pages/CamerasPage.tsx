import type { Camera, CameraSnapshot } from '@krakenos/types';
import { Pause, Pencil, Play, Plus, Trash2, VideoOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { CameraFormSlideover } from '@/components/cameras/CameraFormSlideover';
import { CameraLivePlayer } from '@/components/cameras/CameraLivePlayer';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DeleteButton } from '@/components/ui/delete-button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { deleteCamera, listCameras } from '@/lib/cameras';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

interface TileProps {
  camera: Camera;
  isAdmin: boolean;
  onEdit: (camera: Camera) => void;
  onDelete: (camera: Camera) => Promise<void>;
}

function CameraTile({ camera, isAdmin, onEdit, onDelete }: TileProps) {
  const t = useT();
  const [image, setImage] = useState<string | null>(null);
  // Vídeo en vivo (HLS, US-185) bajo demanda: mientras está en `false` la tarjeta
  // muestra el snapshot que se refresca cada 3 s; al activarlo transcodifica.
  const [live, setLive] = useState(false);

  useEffect(() => {
    // El snapshot se pausa mientras se ve el vídeo en vivo (ahorra peticiones).
    if (!camera.online || live) return;
    let active = true;
    const load = () =>
      api
        .get<CameraSnapshot>(`/cameras/${camera.id}/snapshot`)
        .then((s) => active && setImage(s.image))
        .catch(() => active && setImage(null));
    void load();
    const id = setInterval(load, 3000); // refresca el snapshot ("en vivo")
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [camera.id, camera.online, live]);

  // Si la cámara pasa a offline mientras se mira, corta el vídeo.
  useEffect(() => {
    if (!camera.online) setLive(false);
  }, [camera.online]);

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-video bg-secondary/40">
        {live ? (
          <CameraLivePlayer camera={camera} />
        ) : camera.online && image ? (
          <img
            src={image}
            alt={t('cameras.tileAlt', { name: camera.name })}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <VideoOff className="h-8 w-8" />
            <span className="text-xs">
              {camera.online ? t('cameras.connecting') : t('cameras.noSignal')}
            </span>
          </div>
        )}
        {camera.online && !live && (
          <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
            {t('cameras.live')}
          </span>
        )}
        {camera.online && (
          <Button
            variant="outline"
            size="sm"
            className="absolute bottom-2 left-2 gap-1"
            onClick={() => setLive((v) => !v)}
            aria-label={live ? t('cameras.stopLive') : t('cameras.watchLive')}
          >
            {live ? (
              <Pause className="h-4 w-4" aria-hidden />
            ) : (
              <Play className="h-4 w-4" aria-hidden />
            )}
            <span className="text-xs">{live ? t('cameras.stopLive') : t('cameras.watchLive')}</span>
          </Button>
        )}
      </div>
      <CardContent className="flex items-center justify-between gap-2 py-3">
        <div className="min-w-0">
          <span className="block truncate text-sm font-medium">{camera.name}</span>
          <span className="text-xs text-muted-foreground">{camera.room ?? '—'}</span>
        </div>
        {isAdmin && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onEdit(camera)}
              aria-label={t('cameras.edit', { name: camera.name })}
            >
              <Pencil className="h-4 w-4" aria-hidden />
            </Button>
            <DeleteButton
              onDelete={() => onDelete(camera)}
              aria-label={t('cameras.delete', { name: camera.name })}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </DeleteButton>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CamerasPage() {
  const t = useT();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // `false` = cerrado · `true` = alta · `Camera` = edición de esa cámara.
  const [panel, setPanel] = useState<false | true | Camera>(false);

  const load = useCallback(() => {
    setError(null);
    return listCameras()
      .then(setCameras)
      .catch((err) => setError(describeError(err, t('cameras.loadError'))));
  }, [t]);

  useEffect(() => {
    let active = true;
    void listCameras()
      .then((list) => active && setCameras(list))
      .catch((err) => active && setError(describeError(err, t('cameras.loadError'))))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [t]);

  const removeCamera = async (camera: Camera) => {
    try {
      await deleteCamera(camera.id);
      toast.success(t('cameras.removed'));
      await load();
    } catch (err) {
      toast.error(describeError(err, t('cameras.removeError')));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t('cameras.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('cameras.subtitle')}</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setPanel(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('cameras.add')}
          </Button>
        )}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="aspect-video w-full rounded-xl" />
          ))}
        </div>
      ) : cameras.length === 0 ? (
        !error && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-kr bg-kr-surface py-16 text-center">
            <p className="text-kr-secondary">
              {isAdmin ? t('cameras.empty.admin') : t('cameras.empty.viewer')}
            </p>
            {isAdmin && (
              <Button onClick={() => setPanel(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                {t('cameras.add')}
              </Button>
            )}
          </div>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cameras.map((c) => (
            <CameraTile
              key={c.id}
              camera={c}
              isAdmin={isAdmin}
              onEdit={(cam) => setPanel(cam)}
              onDelete={removeCamera}
            />
          ))}
        </div>
      )}

      {panel !== false && (
        <CameraFormSlideover
          camera={panel === true ? null : panel}
          onClose={() => setPanel(false)}
          onSaved={() => void load()}
        />
      )}
    </div>
  );
}
