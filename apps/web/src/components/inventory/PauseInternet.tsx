import type { Device } from '@krakenos/types';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { pauseInternet, resumeInternet } from '@/lib/access';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { toast } from '@/store/toast.store';

interface Props {
  device: Device;
  canEdit: boolean;
}

const OPTIONS = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1 h' },
  { minutes: 120, label: '2 h' },
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Pausa de internet de un toque (US-111): corta el acceso de un dispositivo N
 * minutos y se reanuda solo. Estado local sembrado desde `device.pausedUntil`.
 */
export function PauseInternet({ device, canEdit }: Props) {
  const t = useT();
  const [pausedUntil, setPausedUntil] = useState<string | null>(device.pausedUntil ?? null);
  const [busy, setBusy] = useState(false);

  const active = pausedUntil != null && new Date(pausedUntil).getTime() > Date.now();

  const pause = async (minutes: number) => {
    setBusy(true);
    try {
      const res = await pauseInternet(device.mac, minutes);
      setPausedUntil(res.pausedUntil);
      toast.success(t('pauseInternet.paused'));
    } catch (err) {
      toast.error(describeError(err, t('pauseInternet.pauseError')));
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    setBusy(true);
    try {
      await resumeInternet(device.mac);
      setPausedUntil(null);
      toast.success(t('pauseInternet.resumed'));
    } catch (err) {
      toast.error(describeError(err, t('pauseInternet.resumeError')));
    } finally {
      setBusy(false);
    }
  };

  if (!active && !canEdit) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-kr-sm">
      {active ? (
        <>
          <span className="text-warning">{t('pauseInternet.until', { time: formatTime(pausedUntil!) })}</span>
          {canEdit && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void resume()}>
              {t('pauseInternet.resume')}
            </Button>
          )}
        </>
      ) : (
        <>
          <span className="text-kr-secondary">{t('pauseInternet.label')}</span>
          {OPTIONS.map((o) => (
            <Button
              key={o.minutes}
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void pause(o.minutes)}
            >
              {o.label}
            </Button>
          ))}
        </>
      )}
    </div>
  );
}
