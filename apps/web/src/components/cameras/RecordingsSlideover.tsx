import type { Camera, Recording } from '@krakenos/types';
import { Download, Film, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DeleteButton } from '@/components/ui/delete-button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { Slideover } from '@/components/ui/slideover';
import { deleteRecording, downloadRecording, listRecordings } from '@/lib/cameras';
import { describeError } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { toast } from '@/store/toast.store';

interface Props {
  camera: Camera;
  isAdmin: boolean;
  onClose: () => void;
}

/** Timeline de clips grabados de una cámara (US-187): miniatura + descarga. */
export function RecordingsSlideover({ camera, isAdmin, onClose }: Props) {
  const t = useT();
  const [clips, setClips] = useState<Recording[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    return listRecordings(camera.id)
      .then(setClips)
      .catch((err) => {
        setClips([]);
        setError(describeError(err, t('cameras.recordings.loadError')));
      });
  }, [camera.id, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const download = async (id: string) => {
    try {
      await downloadRecording(id);
    } catch (err) {
      toast.error(describeError(err, t('cameras.recordings.downloadError')));
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteRecording(id);
      toast.success(t('cameras.recordings.removed'));
      await load();
    } catch (err) {
      toast.error(describeError(err, t('cameras.recordings.removeError')));
    }
  };

  return (
    <Slideover open onClose={onClose} title={t('cameras.recordings.title')} subtitle={camera.name}>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      {clips === null ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : clips.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-kr-secondary">
          <Film className="h-8 w-8" aria-hidden />
          <p className="text-kr-sm">{t('cameras.recordings.empty')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {clips.map((clip) => (
            <li
              key={clip.id}
              className="flex items-center gap-3 rounded-lg border border-kr bg-kr-surface p-2"
            >
              <div className="h-14 w-20 shrink-0 overflow-hidden rounded bg-black">
                {clip.snapshot ? (
                  <img src={clip.snapshot} alt="" className="h-full w-full object-cover" aria-hidden />
                ) : (
                  <div className="flex h-full items-center justify-center text-kr-secondary">
                    <Film className="h-5 w-5" aria-hidden />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-kr-sm font-medium">
                  {new Date(clip.startedAt).toLocaleString()}
                </p>
                <p className="text-kr-xs text-kr-secondary">
                  {clip.durationSec}s · {formatBytes(clip.sizeBytes)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void download(clip.id)}
                aria-label={t('cameras.recordings.download')}
              >
                <Download className="h-4 w-4" aria-hidden />
              </Button>
              {isAdmin && (
                <DeleteButton
                  onDelete={() => remove(clip.id)}
                  aria-label={t('cameras.recordings.delete')}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </DeleteButton>
              )}
            </li>
          ))}
        </ul>
      )}
    </Slideover>
  );
}
