import type { Camera } from '@krakenos/types';
import type HlsPlayer from 'hls.js';
import { Loader2, VideoOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ApiRequestError } from '@/lib/api';
import { startStream, stopStream, streamPlaylistUrl } from '@/lib/cameras';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';

interface CameraLivePlayerProps {
  camera: Camera;
}

/**
 * Reproductor de vídeo en vivo (HLS, US-185). Arranca el stream bajo demanda al
 * montarse y lo **detiene al desmontarse** (no transcodificar cuando nadie mira).
 *
 * - Usa **hls.js** (cargado de forma perezosa, chunk aparte para no engordar la
 *   entrada) donde MSE está disponible, y el `<video>` **nativo** donde el
 *   navegador reproduce HLS por sí solo (Safari).
 * - La playlist/segmentos se autentican con un **token efímero en la URL** (ni
 *   hls.js ni el `<video>` nativo pueden añadir cabeceras a los segmentos); el
 *   token se **refresca** antes de caducar mientras el reproductor sigue abierto.
 */
export function CameraLivePlayer({ camera }: CameraLivePlayerProps) {
  const t = useT();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let hls: HlsPlayer | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let started = false;

    // Refresca el token antes de que caduque (la sesión sigue viva en el servidor).
    const scheduleRefresh = (expiresIn: number) => {
      const ms = Math.max(5, expiresIn - 20) * 1000;
      refreshTimer = setTimeout(() => {
        void (async () => {
          try {
            const s = await startStream(camera.id);
            if (cancelled) return;
            const url = streamPlaylistUrl(camera.id, s.token);
            if (hls) hls.loadSource(url);
            else if (videoRef.current) videoRef.current.src = url;
            scheduleRefresh(s.expiresIn);
          } catch {
            // Best-effort: un fallo de refresco se manifestará como error de reproducción.
          }
        })();
      }, ms);
    };

    const run = async () => {
      try {
        const session = await startStream(camera.id);
        if (cancelled) return;
        started = true;
        const url = streamPlaylistUrl(camera.id, session.token);
        const video = videoRef.current;
        if (!video) return;

        // HLS nativo (Safari): la playlist directa, sin hls.js.
        if (video.canPlayType('application/vnd.apple.mpegurl')) {
          video.src = url;
          void video.play().catch(() => {});
          setLoading(false);
          scheduleRefresh(session.expiresIn);
          return;
        }

        // Build ligera (sin subtítulos/DRM): basta para HLS en vivo y pesa menos.
        const { default: Hls } = await import('hls.js/light');
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setError(t('cameras.streamUnsupported'));
          setLoading(false);
          return;
        }
        // Worker deshabilitado a propósito: evita relajar la CSP con `worker-src blob:`.
        hls = new Hls({ enableWorker: false });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          setLoading(false);
          void video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (data.fatal && !cancelled) setError(t('cameras.streamError'));
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        scheduleRefresh(session.expiresIn);
      } catch (err) {
        if (cancelled) return;
        setLoading(false);
        if (err instanceof ApiRequestError && err.status === 429) {
          setError(t('cameras.streamLimit'));
        } else {
          setError(describeError(err, t('cameras.streamError')));
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (hls) {
        hls.destroy();
        hls = null;
      }
      // Libera la sesión en el servidor (best-effort). `Promise.resolve` por si
      // el llamador devolviera algo no-thenable (robustez ante el desmontaje).
      if (started) void Promise.resolve(stopStream(camera.id)).catch(() => {});
    };
  }, [camera.id, t]);

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
        <VideoOff className="h-8 w-8" aria-hidden />
        <span className="px-4 text-center text-xs">{error}</span>
      </div>
    );
  }

  return (
    <>
      <video
        ref={videoRef}
        className="h-full w-full bg-black object-contain"
        muted
        playsInline
        controls
        aria-label={t('cameras.tileAlt', { name: camera.name })}
      />
      {loading && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" aria-hidden />
          <span className="text-xs">{t('cameras.starting')}</span>
        </div>
      )}
    </>
  );
}
