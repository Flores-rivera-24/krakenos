import type { Camera, MotionArming, MotionSensitivity } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slideover } from '@/components/ui/slideover';
import { Switch } from '@/components/ui/switch';
import { getMotionConfig, updateMotionConfig } from '@/lib/cameras';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { DAY_LABELS, minuteToTimeString, timeStringToMinute } from '@/lib/iot-schedules';
import { toast } from '@/store/toast.store';

interface Props {
  camera: Camera;
  onClose: () => void;
}

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const SELECT_CLASS =
  'w-full rounded-md border border-kr bg-kr-surface px-3 py-2 text-kr-sm text-kr-primary';

/** Panel de configuración de la detección de movimiento de una cámara (US-186). */
export function MotionSettingsSlideover({ camera, onClose }: Props) {
  const t = useT();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [sensitivity, setSensitivity] = useState<MotionSensitivity>('medium');
  const [cooldownSec, setCooldownSec] = useState(60);
  const [armMode, setArmMode] = useState<MotionArming['mode']>('always');
  const [fromTime, setFromTime] = useState('22:00');
  const [toTime, setToTime] = useState('07:00');
  const [days, setDays] = useState<number[]>(ALL_DAYS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getMotionConfig(camera.id)
      .then((cfg) => {
        if (!active) return;
        setEnabled(cfg.enabled);
        setSensitivity(cfg.sensitivity);
        setCooldownSec(cfg.cooldownSec);
        setArmMode(cfg.arming.mode);
        if (cfg.arming.mode === 'schedule' && cfg.arming.windows[0]) {
          const w = cfg.arming.windows[0];
          setFromTime(minuteToTimeString(w.fromMinute));
          setToTime(minuteToTimeString(w.toMinute));
          setDays(w.days ?? ALL_DAYS);
        }
      })
      .catch((err) => active && setError(describeError(err, t('cameras.motion.loadError'))))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [camera.id, t]);

  const toggleDay = (d: number) =>
    setDays((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d].sort()));

  const buildArming = (): MotionArming => {
    if (armMode === 'always') return { mode: 'always' };
    if (armMode === 'never') return { mode: 'never' };
    return {
      mode: 'schedule',
      windows: [
        {
          fromMinute: timeStringToMinute(fromTime),
          toMinute: timeStringToMinute(toTime),
          ...(days.length > 0 && days.length < 7 ? { days } : {}),
        },
      ],
    };
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateMotionConfig(camera.id, {
        enabled,
        sensitivity,
        cooldownSec,
        arming: buildArming(),
      });
      toast.success(t('cameras.motion.saved'));
      onClose();
    } catch (err) {
      const message = describeError(err, t('cameras.motion.saveError'));
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <div className="space-y-2">
      {error && <p className="text-kr-sm text-danger">{error}</p>}
      <Button onClick={() => void submit()} disabled={saving || loading} className="w-full">
        {saving ? t('cameras.motion.saving') : t('cameras.motion.save')}
      </Button>
    </div>
  );

  return (
    <Slideover
      open
      onClose={onClose}
      title={t('cameras.motion.title')}
      subtitle={camera.name}
      footer={footer}
    >
      {loading ? (
        <p className="text-kr-sm text-kr-secondary">{t('cameras.motion.loading')}</p>
      ) : (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <Label>{t('cameras.motion.enabled')}</Label>
              <p className="text-kr-xs text-kr-secondary">{t('cameras.motion.enabledHint')}</p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label={t('cameras.motion.enabled')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="motion-sensitivity">{t('cameras.motion.sensitivity')}</Label>
            <select
              id="motion-sensitivity"
              className={SELECT_CLASS}
              value={sensitivity}
              onChange={(e) => setSensitivity(e.target.value as MotionSensitivity)}
            >
              <option value="low">{t('cameras.motion.sensLow')}</option>
              <option value="medium">{t('cameras.motion.sensMedium')}</option>
              <option value="high">{t('cameras.motion.sensHigh')}</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="motion-cooldown">{t('cameras.motion.cooldown')}</Label>
            <Input
              id="motion-cooldown"
              type="number"
              min={5}
              max={3600}
              value={cooldownSec}
              onChange={(e) => setCooldownSec(Number(e.target.value))}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="motion-arm">{t('cameras.motion.arming')}</Label>
            <select
              id="motion-arm"
              className={SELECT_CLASS}
              value={armMode}
              onChange={(e) => setArmMode(e.target.value as MotionArming['mode'])}
            >
              <option value="always">{t('cameras.motion.armAlways')}</option>
              <option value="never">{t('cameras.motion.armNever')}</option>
              <option value="schedule">{t('cameras.motion.armSchedule')}</option>
            </select>
          </div>

          {armMode === 'schedule' && (
            <div className="space-y-3 rounded-md border border-kr p-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="motion-from">{t('cameras.motion.from')}</Label>
                  <Input
                    id="motion-from"
                    type="time"
                    value={fromTime}
                    onChange={(e) => setFromTime(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="motion-to">{t('cameras.motion.to')}</Label>
                  <Input
                    id="motion-to"
                    type="time"
                    value={toTime}
                    onChange={(e) => setToTime(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ALL_DAYS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    aria-pressed={days.includes(d)}
                    className={
                      'rounded px-2 py-1 text-kr-xs ' +
                      (days.includes(d)
                        ? 'bg-kr-accent text-kr-on-accent'
                        : 'border border-kr text-kr-secondary')
                    }
                  >
                    {DAY_LABELS[d]}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Slideover>
  );
}
