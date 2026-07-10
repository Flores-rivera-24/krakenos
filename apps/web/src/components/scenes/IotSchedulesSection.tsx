import type {
  IotDevice,
  IotSchedule,
  IotScheduleTarget,
  IotScheduleTime,
  Scene,
} from '@krakenos/types';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DeleteButton } from '@/components/ui/delete-button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Input } from '@/components/ui/input';
import { LoadingLine } from '@/components/ui/loading-line';
import { Label } from '@/components/ui/label';
import { Slideover } from '@/components/ui/slideover';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import {
  DAY_LABEL_KEYS,
  createIotSchedule,
  dayLabel,
  deleteIotSchedule,
  formatScheduleTime,
  listIotSchedules,
  minuteToTimeString,
  timeStringToMinute,
  updateIotSchedule,
} from '@/lib/iot-schedules';
import { cn } from '@/lib/utils';
import { toast } from '@/store/toast.store';

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-kr bg-kr-elevated px-3 py-2 text-kr-base text-kr-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** Editor de un horario IoT (US-168). */
function ScheduleEditor({
  schedule,
  devices,
  scenes,
  onClose,
  onSaved,
}: {
  schedule: IotSchedule | null;
  devices: IotDevice[];
  scenes: Scene[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const editing = schedule !== null;
  const controllable = devices.filter((d) => d.on !== null);

  const [name, setName] = useState(schedule?.name ?? '');
  const [days, setDays] = useState<number[]>(schedule?.days ?? [1, 2, 3, 4, 5]);
  const [timeKind, setTimeKind] = useState<IotScheduleTime['kind']>(schedule?.time.kind ?? 'fixed');
  const [fixedTime, setFixedTime] = useState(
    schedule?.time.kind === 'fixed' ? minuteToTimeString(schedule.time.minute) : '07:00',
  );
  const [offset, setOffset] = useState(
    schedule && schedule.time.kind !== 'fixed' ? schedule.time.offsetMin : 0,
  );
  const [targetType, setTargetType] = useState<IotScheduleTarget['type']>(
    schedule?.target.type ?? 'device',
  );
  const [deviceId, setDeviceId] = useState(
    schedule?.target.type === 'device' ? schedule.target.deviceId : (controllable[0]?.id ?? ''),
  );
  const [deviceOn, setDeviceOn] = useState(
    schedule?.target.type === 'device' ? (schedule.target.on ?? true) : true,
  );
  const [sceneId, setSceneId] = useState(
    schedule?.target.type === 'scene' ? schedule.target.sceneId : (scenes[0]?.id ?? ''),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleDay = (d: number) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d].sort()));

  const buildTime = (): IotScheduleTime =>
    timeKind === 'fixed'
      ? { kind: 'fixed', minute: timeStringToMinute(fixedTime) }
      : { kind: timeKind, offsetMin: offset };

  const buildTarget = (): IotScheduleTarget =>
    targetType === 'device'
      ? { type: 'device', deviceId, on: deviceOn }
      : { type: 'scene', sceneId };

  const save = async () => {
    if (name.trim() === '') return setError(t('iotSchedule.nameRequired'));
    if (days.length === 0) return setError(t('iotSchedule.dayRequired'));
    if (targetType === 'device' && !deviceId) return setError(t('iotSchedule.deviceRequired'));
    if (targetType === 'scene' && !sceneId) return setError(t('iotSchedule.sceneRequired'));
    setSaving(true);
    setError(null);
    try {
      const body = { name: name.trim(), days, time: buildTime(), target: buildTarget() };
      if (editing) {
        await updateIotSchedule(schedule.id, body);
        toast.success(t('iotSchedule.updated'));
      } else {
        await createIotSchedule(body);
        toast.success(t('iotSchedule.created'));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, t('iotSchedule.saveError')));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    try {
      await deleteIotSchedule(schedule.id);
      toast.success(t('iotSchedule.deleted'));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(describeError(err, t('iotSchedule.deleteError')));
    }
  };

  return (
    <Slideover
      open
      onClose={onClose}
      title={editing ? t('iotSchedule.editTitle') : t('iotSchedule.new')}
      footer={
        <div className="space-y-2">
          {error && <p className="text-kr-sm text-danger">{error}</p>}
          <Button onClick={() => void save()} disabled={saving} className="w-full">
            {saving ? t('common.saving') : t('common.save')}
          </Button>
          {editing && (
            <DeleteButton onDelete={remove} variant="destructive" className="w-full">
              {t('iotSchedule.deleteSchedule')}
            </DeleteButton>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="sch-name">{t('iotSchedule.nameLabel')}</Label>
          <Input id="sch-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t('iotSchedule.namePlaceholder')} />
        </div>

        <div className="space-y-2">
          <Label>{t('iotSchedule.daysLabel')}</Label>
          <div className="flex flex-wrap gap-1">
            {DAY_LABEL_KEYS.map((key, d) => (
              <button
                key={d}
                type="button"
                aria-pressed={days.includes(d)}
                onClick={() => toggleDay(d)}
                className={cn(
                  'h-9 w-11 rounded-md border text-kr-xs transition-colors',
                  days.includes(d)
                    ? 'border-kr-accent bg-kr-accent-faint text-kr-primary'
                    : 'border-kr bg-kr-elevated text-kr-muted',
                )}
              >
                {t(key)}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="sch-when">{t('iotSchedule.whenLabel')}</Label>
          <select
            id="sch-when"
            className={SELECT_CLASS}
            value={timeKind}
            onChange={(e) => setTimeKind(e.target.value as IotScheduleTime['kind'])}
          >
            <option value="fixed">{t('iotSchedule.whenFixed')}</option>
            <option value="sunrise">{t('iotSchedule.whenSunrise')}</option>
            <option value="sunset">{t('iotSchedule.whenSunset')}</option>
          </select>
          {timeKind === 'fixed' ? (
            <Input
              type="time"
              aria-label={t('iotSchedule.timeLabel')}
              value={fixedTime}
              onChange={(e) => setFixedTime(e.target.value)}
            />
          ) : (
            <div className="flex items-center gap-2">
              <Label htmlFor="sch-offset" className="text-kr-sm text-kr-secondary">
                {t('iotSchedule.offsetLabel')}
              </Label>
              <Input
                id="sch-offset"
                type="number"
                min={-720}
                max={720}
                value={offset}
                onChange={(e) => setOffset(Number(e.target.value))}
                className="w-24"
              />
              <span className="text-kr-xs text-kr-muted">{t('iotSchedule.offsetHint')}</span>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="sch-target">{t('iotSchedule.targetLabel')}</Label>
          <select
            id="sch-target"
            className={SELECT_CLASS}
            value={targetType}
            onChange={(e) => setTargetType(e.target.value as IotScheduleTarget['type'])}
          >
            <option value="device">{t('iotSchedule.targetDevice')}</option>
            <option value="scene">{t('iotSchedule.targetScene')}</option>
          </select>
          {targetType === 'device' ? (
            <div className="space-y-2">
              <select
                aria-label={t('iotSchedule.deviceAria')}
                className={SELECT_CLASS}
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
              >
                {controllable.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('iotSchedule.actionAria')}
                className={SELECT_CLASS}
                value={deviceOn ? 'on' : 'off'}
                onChange={(e) => setDeviceOn(e.target.value === 'on')}
              >
                <option value="on">{t('iotSchedule.turnOn')}</option>
                <option value="off">{t('iotSchedule.turnOff')}</option>
              </select>
            </div>
          ) : (
            <select
              aria-label={t('iotSchedule.sceneAria')}
              className={SELECT_CLASS}
              value={sceneId}
              onChange={(e) => setSceneId(e.target.value)}
            >
              {scenes.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </Slideover>
  );
}

/** Ubicación del hogar (lat/long) para el cálculo solar (US-168). */
function HomeLocationCard() {
  const t = useT();
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .get<{ settings: Record<string, string> }>('/system/settings')
      .then((res) => {
        setLat(res.settings.homeLatitude ?? '');
        setLon(res.settings.homeLongitude ?? '');
      })
      .catch(() => undefined);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/system/settings', { key: 'homeLatitude', value: lat });
      await api.patch('/system/settings', { key: 'homeLongitude', value: lon });
      toast.success(t('iotSchedule.locationSaved'));
    } catch (err) {
      toast.error(describeError(err, t('iotSchedule.locationSaveError')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg border border-kr bg-kr-elevated p-3">
      <p className="mb-1 text-kr-sm font-medium text-kr-primary">{t('iotSchedule.locationTitle')}</p>
      <p className="mb-2 text-kr-xs text-kr-muted">
        {t('iotSchedule.locationHint')}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="home-lat" className="text-kr-xs">{t('iotSchedule.latitude')}</Label>
          <Input id="home-lat" type="number" value={lat} onChange={(e) => setLat(e.target.value)} className="w-28" placeholder="40.41" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="home-lon" className="text-kr-xs">{t('iotSchedule.longitude')}</Label>
          <Input id="home-lon" type="number" value={lon} onChange={(e) => setLon(e.target.value)} className="w-28" placeholder="-3.70" />
        </div>
        <Button variant="outline" size="sm" disabled={saving} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}

/** Sección de programación de IoT/escenas por horario (US-168), en la página de Escenas. */
export function IotSchedulesSection({
  devices,
  scenes,
  isAdmin,
}: {
  devices: IotDevice[];
  scenes: Scene[];
  isAdmin: boolean;
}) {
  const t = useT();
  const [schedules, setSchedules] = useState<IotSchedule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<IotSchedule | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const reload = useCallback(() => {
    void listIotSchedules()
      .then((list) => {
        setSchedules(list);
        setError(null);
      })
      .catch((err) => {
        // No fingir "sin horarios": el fallo se muestra y la lista deja de cargar (AUD-15).
        setSchedules((prev) => prev ?? []);
        setError(describeError(err, t('iotSchedule.loadError')));
      });
  }, [t]);

  useEffect(() => reload(), [reload]);

  const targetLabel = (s: IotSchedule): string => {
    const target = s.target;
    if (target.type === 'scene') {
      return t('iotSchedule.targetScenePrefix', {
        name: scenes.find((x) => x.id === target.sceneId)?.name ?? target.sceneId,
      });
    }
    const dev = devices.find((d) => d.id === target.deviceId)?.name ?? target.deviceId;
    return t('iotSchedule.targetDeviceLine', {
      device: dev,
      action: target.on === false ? t('iotSchedule.actionOff') : t('iotSchedule.actionOn'),
    });
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-kr-lg font-semibold text-kr-primary">{t('iotSchedule.title')}</h3>
        {isAdmin && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            {t('iotSchedule.new')}
          </Button>
        )}
      </div>

      {isAdmin && <HomeLocationCard />}

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {schedules === null ? (
        <LoadingLine label={t('iotSchedule.loading')} />
      ) : schedules.length === 0 ? (
        !error && (
          <p className="text-kr-sm text-kr-muted">
            {t('iotSchedule.empty')}
          </p>
        )
      ) : (
        <ul className="divide-y divide-kr-muted overflow-hidden rounded-lg border border-kr">
          {schedules.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-3 bg-kr-surface px-3 py-2"
            >
              <button
                type="button"
                disabled={!isAdmin}
                onClick={() => {
                  setEditing(s);
                  setEditorOpen(true);
                }}
                className="min-w-0 flex-1 text-left disabled:cursor-default"
              >
                <span className="block truncate text-kr-sm text-kr-primary">
                  {s.name} {!s.enabled && <span className="text-kr-muted">{t('iotSchedule.disabled')}</span>}
                </span>
                <span className="block truncate text-kr-xs text-kr-muted">
                  {formatScheduleTime(s.time)} · {s.days.map(dayLabel).join(' ')} ·{' '}
                  {targetLabel(s)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {editorOpen && (
        <ScheduleEditor
          schedule={editing}
          devices={devices}
          scenes={scenes}
          onClose={() => setEditorOpen(false)}
          onSaved={reload}
        />
      )}
    </section>
  );
}
