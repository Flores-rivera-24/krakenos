import type { Device } from '@krakenos/types';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { pauseInternet, resumeInternet } from '@/lib/access';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import type { TranslationKey } from '@/lib/i18n';
import { toast } from '@/store/toast.store';

interface Props {
  device: Device;
  canEdit: boolean;
}

const OPTIONS: { minutes: number; labelKey: TranslationKey }[] = [
  { minutes: 30, labelKey: 'inventory.pause.opt30' },
  { minutes: 60, labelKey: 'inventory.pause.opt1h' },
  { minutes: 120, labelKey: 'inventory.pause.opt2h' },
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
      toast.success(t('inventory.pause.paused'));
    } catch (err) {
      toast.error(describeError(err, t('inventory.pause.pauseError')));
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    setBusy(true);
    try {
      await resumeInternet(device.mac);
      setPausedUntil(null);
      toast.success(t('inventory.pause.resumed'));
    } catch (err) {
      toast.error(describeError(err, t('inventory.pause.resumeError')));
    } finally {
      setBusy(false);
    }
  };

  if (!active && !canEdit) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-kr-sm">
      {active ? (
        <>
          <span className="text-warning">
            {t('inventory.pause.pausedUntil', { time: formatTime(pausedUntil!) })}
          </span>
          {canEdit && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void resume()}>
              {t('inventory.pause.resume')}
            </Button>
          )}
        </>
      ) : (
        <>
          <span className="text-kr-secondary">{t('inventory.pause.label')}</span>
          {OPTIONS.map((o) => (
            <Button
              key={o.minutes}
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void pause(o.minutes)}
            >
              {t(o.labelKey)}
            </Button>
          ))}
        </>
      )}
    </div>
  );
}
