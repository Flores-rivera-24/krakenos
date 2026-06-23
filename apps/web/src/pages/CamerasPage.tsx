import type { Camera, CameraSnapshot } from '@krakenos/types';
import { VideoOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';

function CameraTile({ camera }: { camera: Camera }) {
  const [image, setImage] = useState<string | null>(null);

  useEffect(() => {
    if (!camera.online) return;
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
  }, [camera.id, camera.online]);

  return (
    <Card className="overflow-hidden">
      <div className="relative aspect-video bg-secondary/40">
        {camera.online && image ? (
          <img src={image} alt={`Cámara ${camera.name}`} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <VideoOff className="h-8 w-8" />
            <span className="text-xs">{camera.online ? 'Cargando…' : 'Sin señal'}</span>
          </div>
        )}
        {camera.online && (
          <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-red-400">
            ● EN VIVO
          </span>
        )}
      </div>
      <CardContent className="flex items-center justify-between py-3">
        <span className="text-sm font-medium">{camera.name}</span>
        <span className="text-xs text-muted-foreground">{camera.room ?? '—'}</span>
      </CardContent>
    </Card>
  );
}

export function CamerasPage() {
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .get<Camera[]>('/cameras')
      .then((list) => active && setCameras(list))
      .catch((err) => active && setError(describeError(err, 'No se pudieron cargar las cámaras')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">Cámaras</h2>
        <p className="text-sm text-muted-foreground">Vista de las cámaras IP del hogar.</p>
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
          <p className="py-12 text-center text-sm text-kr-muted">
            Aún no hay cámaras configuradas.
          </p>
        )
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cameras.map((c) => (
            <CameraTile key={c.id} camera={c} />
          ))}
        </div>
      )}
    </div>
  );
}
