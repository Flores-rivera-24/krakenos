import type {
  AutomationAction,
  AutomationRule,
  AutomationRun,
  AutomationTrigger,
  Camera,
  Device,
  HomeMode,
  IotDevice,
  Scene,
  UserSummary,
} from '@krakenos/types';
import { HOME_MODES } from '@krakenos/types';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { DeleteButton } from '@/components/ui/delete-button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Slideover } from '@/components/ui/slideover';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import {
  createAutomation,
  deleteAutomation,
  describeAction,
  describeCondition,
  describeTrigger,
  listAutomationRuns,
  listAutomations,
  updateAutomation,
  type NameContext,
} from '@/lib/automations';
import { listCameras } from '@/lib/cameras';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { DAY_LABELS, minuteToTimeString, timeStringToMinute } from '@/lib/iot-schedules';
import { MODE_LABELS } from '@/lib/presence';
import { listScenes } from '@/lib/scenes';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

const SELECT_CLASS =
  'flex h-10 w-full rounded-md border border-kr bg-kr-elevated px-3 py-2 text-kr-base text-kr-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

type TriggerType = AutomationTrigger['type'];
type ActionType = AutomationAction['type'];

/** Etiqueta amable de un dispositivo de red (para selects y frases). */
function networkLabel(d: Device): string {
  return d.label || d.hostname || d.mac;
}

/** Fila editable de acción en el builder (campos superpuestos de todos los tipos). */
interface DraftAction {
  type: ActionType;
  deviceId: string;
  on: boolean;
  sceneId: string;
  mac: string; // '' = el dispositivo del evento
  minutes: number;
  message: string;
}

function defaultAction(iot: IotDevice[], scenes: Scene[]): DraftAction {
  return {
    type: 'iot-set',
    deviceId: iot.find((d) => d.on !== null)?.id ?? '',
    on: true,
    sceneId: scenes[0]?.id ?? '',
    mac: '',
    minutes: 30,
    message: '',
  };
}

function toAction(row: DraftAction): AutomationAction {
  switch (row.type) {
    case 'iot-set':
      return { type: 'iot-set', deviceId: row.deviceId, on: row.on };
    case 'scene-run':
      return { type: 'scene-run', sceneId: row.sceneId };
    case 'device-block':
      return { type: 'device-block', ...(row.mac ? { mac: row.mac } : {}) };
    case 'device-pause':
      return { type: 'device-pause', minutes: row.minutes, ...(row.mac ? { mac: row.mac } : {}) };
    case 'notify':
      return { type: 'notify', message: row.message };
  }
}

function fromAction(action: AutomationAction, base: DraftAction): DraftAction {
  const row = { ...base, type: action.type };
  switch (action.type) {
    case 'iot-set':
      return { ...row, deviceId: action.deviceId ?? '', on: action.on ?? true };
    case 'scene-run':
      return { ...row, sceneId: action.sceneId };
    case 'device-block':
      return { ...row, mac: action.mac ?? '' };
    case 'device-pause':
      return { ...row, mac: action.mac ?? '', minutes: action.minutes };
    case 'notify':
      return { ...row, message: action.message };
  }
}

function RuleEditor({
  rule,
  iotDevices,
  networkDevices,
  scenes,
  users,
  cameras,
  onClose,
  onSaved,
}: {
  rule: AutomationRule | null;
  iotDevices: IotDevice[];
  networkDevices: Device[];
  scenes: Scene[];
  users: UserSummary[];
  cameras: Camera[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const editing = rule !== null;
  const controllable = iotDevices.filter((d) => d.on !== null);
  const sensors = iotDevices.filter((d) => d.reading !== null);

  const [name, setName] = useState(rule?.name ?? '');
  const [triggerType, setTriggerType] = useState<TriggerType>(rule?.trigger.type ?? 'device-new');
  const trg = rule?.trigger;
  const [triggerMac, setTriggerMac] = useState(
    trg && (trg.type === 'device-online' || trg.type === 'device-offline')
      ? trg.mac
      : (networkDevices[0]?.mac ?? ''),
  );
  const [triggerDevice, setTriggerDevice] = useState(
    trg && (trg.type === 'iot-on' || trg.type === 'iot-off' || trg.type === 'sensor-threshold')
      ? trg.deviceId
      : (controllable[0]?.id ?? ''),
  );
  const [sensorOp, setSensorOp] = useState<'gt' | 'lt'>(
    trg?.type === 'sensor-threshold' ? trg.op : 'gt',
  );
  const [sensorValue, setSensorValue] = useState(
    trg?.type === 'sensor-threshold' ? trg.value : 30,
  );
  const [timeDays, setTimeDays] = useState<number[]>(
    trg?.type === 'time' ? trg.days : ALL_DAYS,
  );
  const [timeAt, setTimeAt] = useState(
    trg?.type === 'time' ? minuteToTimeString(trg.minute) : '20:00',
  );
  // Presencia/modos (US-169): '' = cualquier persona.
  const [triggerUserId, setTriggerUserId] = useState(
    trg && (trg.type === 'person-arrived' || trg.type === 'person-left')
      ? (trg.userId ?? '')
      : '',
  );
  const [triggerMode, setTriggerMode] = useState<HomeMode>(
    trg?.type === 'mode-changed' ? trg.mode : 'away',
  );
  // Movimiento (US-186): '' = cualquier cámara.
  const [triggerCamera, setTriggerCamera] = useState(
    trg?.type === 'motion-detected' ? (trg.cameraId ?? '') : '',
  );

  const [withWindow, setWithWindow] = useState(rule?.condition !== undefined);
  const [windowFrom, setWindowFrom] = useState(
    rule?.condition?.fromMinute !== undefined ? minuteToTimeString(rule.condition.fromMinute) : '22:00',
  );
  const [windowTo, setWindowTo] = useState(
    rule?.condition?.toMinute !== undefined ? minuteToTimeString(rule.condition.toMinute) : '07:00',
  );
  const [windowDays, setWindowDays] = useState<number[]>(rule?.condition?.days ?? ALL_DAYS);

  const base = defaultAction(iotDevices, scenes);
  const [actions, setActions] = useState<DraftAction[]>(
    rule ? rule.actions.map((a) => fromAction(a, base)) : [base],
  );
  const [cooldownMin, setCooldownMin] = useState(Math.max(1, Math.round((rule?.cooldownSec ?? 60) / 60)));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleIn = (list: number[], d: number) =>
    list.includes(d) ? list.filter((x) => x !== d) : [...list, d].sort((a, b) => a - b);

  const buildTrigger = (): AutomationTrigger => {
    switch (triggerType) {
      case 'device-new':
        return { type: 'device-new' };
      case 'device-online':
      case 'device-offline':
        return { type: triggerType, mac: triggerMac };
      case 'iot-on':
      case 'iot-off':
        return { type: triggerType, deviceId: triggerDevice };
      case 'sensor-threshold':
        return { type: 'sensor-threshold', deviceId: triggerDevice, op: sensorOp, value: sensorValue };
      case 'energy-threshold':
        // El umbral concreto vive en la regla de alerta de energía (US-183);
        // aquí solo se elige el dispositivo objetivo (vacío = cualquiera).
        return { type: 'energy-threshold', ...(triggerDevice ? { deviceId: triggerDevice } : {}) };
      case 'time':
        return { type: 'time', days: timeDays, minute: timeStringToMinute(timeAt) };
      case 'person-arrived':
      case 'person-left':
        return { type: triggerType, ...(triggerUserId ? { userId: triggerUserId } : {}) };
      case 'mode-changed':
        return { type: 'mode-changed', mode: triggerMode };
      case 'motion-detected':
        return { type: 'motion-detected', ...(triggerCamera ? { cameraId: triggerCamera } : {}) };
    }
  };

  const save = async () => {
    const trimmed = name.trim();
    if (trimmed === '') {
      setError(t('automations.editor.errNoName'));
      return;
    }
    if (actions.length === 0) {
      setError(t('automations.editor.errNoAction'));
      return;
    }
    setSaving(true);
    setError(null);
    const body = {
      name: trimmed,
      trigger: buildTrigger(),
      condition: withWindow
        ? {
            ...(windowDays.length < 7 ? { days: windowDays } : {}),
            fromMinute: timeStringToMinute(windowFrom),
            toMinute: timeStringToMinute(windowTo),
          }
        : null,
      actions: actions.map(toAction),
      cooldownSec: Math.max(5, cooldownMin * 60),
    };
    try {
      if (editing) {
        await updateAutomation(rule.id, body);
        toast.success(t('automations.editor.saved'));
      } else {
        await createAutomation({ ...body, condition: body.condition ?? undefined });
        toast.success(t('automations.editor.created'));
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(describeError(err, t('automations.editor.saveError')));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!editing) return;
    try {
      await deleteAutomation(rule.id);
      toast.success(t('automations.editor.deleted'));
      onSaved();
      onClose();
    } catch (err) {
      toast.error(describeError(err, t('automations.editor.deleteError')));
    }
  };

  const updateAction = (i: number, patch: Partial<DraftAction>) =>
    setActions((prev) => prev.map((row, j) => (j === i ? { ...row, ...patch } : row)));

  /** ¿El disparador aporta un objetivo de red implícito para bloquear/pausar? */
  const eventHasMac =
    triggerType === 'device-new' || triggerType === 'device-online' || triggerType === 'device-offline';

  const dayPicker = (selected: number[], onToggle: (d: number) => void, label: string) => (
    <div className="flex flex-wrap gap-1" role="group" aria-label={label}>
      {DAY_LABELS.map((text, d) => (
        <button
          key={d}
          type="button"
          aria-pressed={selected.includes(d)}
          onClick={() => onToggle(d)}
          className={cn(
            'h-9 w-11 rounded-md border text-kr-xs transition-colors',
            selected.includes(d)
              ? 'border-kr-accent bg-kr-accent-faint text-kr-primary'
              : 'border-kr bg-kr-elevated text-kr-muted',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );

  return (
    <Slideover
      open
      onClose={onClose}
      title={editing ? t('automations.editor.editTitle') : t('automations.new')}
      footer={
        <div className="space-y-2">
          {error && <p className="text-kr-sm text-danger">{error}</p>}
          <Button onClick={() => void save()} disabled={saving} className="w-full">
            {saving ? t('automations.editor.saving') : t('automations.editor.save')}
          </Button>
          {editing && (
            <DeleteButton onDelete={remove} variant="destructive" className="w-full">
              {t('automations.editor.delete')}
            </DeleteButton>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        <div className="space-y-2">
          <Label htmlFor="auto-name">{t('automations.editor.nameLabel')}</Label>
          <Input
            id="auto-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder={t('automations.editor.namePlaceholder')}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="auto-when">{t('automations.editor.whenLabel')}</Label>
          <select
            id="auto-when"
            className={SELECT_CLASS}
            value={triggerType}
            onChange={(e) => setTriggerType(e.target.value as TriggerType)}
          >
            <option value="device-new">{t('automations.trigger.deviceNew')}</option>
            <option value="device-online">{t('automations.trigger.deviceOnline')}</option>
            <option value="device-offline">{t('automations.trigger.deviceOffline')}</option>
            <option value="iot-on">{t('automations.trigger.iotOn')}</option>
            <option value="iot-off">{t('automations.trigger.iotOff')}</option>
            <option value="sensor-threshold">{t('automations.trigger.sensorThreshold')}</option>
            <option value="energy-threshold">{t('automations.trigger.energyThreshold')}</option>
            <option value="motion-detected">{t('automations.trigger.motionDetected')}</option>
            <option value="time">{t('automations.trigger.time')}</option>
            <option value="person-arrived">{t('automations.trigger.personArrived')}</option>
            <option value="person-left">{t('automations.trigger.personLeft')}</option>
            <option value="mode-changed">{t('automations.trigger.modeChanged')}</option>
          </select>

          {(triggerType === 'device-online' || triggerType === 'device-offline') && (
            <select
              aria-label={t('automations.editor.networkDeviceAria')}
              className={SELECT_CLASS}
              value={triggerMac}
              onChange={(e) => setTriggerMac(e.target.value)}
            >
              {networkDevices.map((d) => (
                <option key={d.mac} value={d.mac}>
                  {networkLabel(d)}
                </option>
              ))}
            </select>
          )}
          {(triggerType === 'iot-on' || triggerType === 'iot-off') && (
            <select
              aria-label={t('automations.editor.iotDeviceAria')}
              className={SELECT_CLASS}
              value={triggerDevice}
              onChange={(e) => setTriggerDevice(e.target.value)}
            >
              {controllable.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          {triggerType === 'energy-threshold' && (
            <select
              aria-label={t('automations.editor.iotDeviceAria')}
              className={SELECT_CLASS}
              value={triggerDevice}
              onChange={(e) => setTriggerDevice(e.target.value)}
            >
              <option value="">{t('automations.editor.anyDevice')}</option>
              {controllable.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          {triggerType === 'motion-detected' && (
            <select
              aria-label={t('automations.editor.cameraAria')}
              className={SELECT_CLASS}
              value={triggerCamera}
              onChange={(e) => setTriggerCamera(e.target.value)}
            >
              <option value="">{t('automations.editor.anyCamera')}</option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {triggerType === 'sensor-threshold' && (
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label={t('automations.editor.sensorAria')}
                className={cn(SELECT_CLASS, 'w-auto min-w-40 flex-1')}
                value={triggerDevice}
                onChange={(e) => setTriggerDevice(e.target.value)}
              >
                {sensors.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={t('automations.editor.comparisonAria')}
                className={cn(SELECT_CLASS, 'w-auto')}
                value={sensorOp}
                onChange={(e) => setSensorOp(e.target.value as 'gt' | 'lt')}
              >
                <option value="gt">{t('automations.editor.opGt')}</option>
                <option value="lt">{t('automations.editor.opLt')}</option>
              </select>
              <Input
                type="number"
                aria-label={t('automations.editor.thresholdAria')}
                value={sensorValue}
                onChange={(e) => setSensorValue(Number(e.target.value))}
                className="w-24"
              />
            </div>
          )}
          {triggerType === 'time' && (
            <div className="space-y-2">
              {dayPicker(
                timeDays,
                (d) => setTimeDays((prev) => toggleIn(prev, d)),
                t('automations.editor.triggerDaysAria'),
              )}
              <Input
                type="time"
                aria-label={t('automations.editor.triggerTimeAria')}
                value={timeAt}
                onChange={(e) => setTimeAt(e.target.value)}
              />
            </div>
          )}
          {(triggerType === 'person-arrived' || triggerType === 'person-left') && (
            <select
              aria-label={t('automations.editor.personAria')}
              className={SELECT_CLASS}
              value={triggerUserId}
              onChange={(e) => setTriggerUserId(e.target.value)}
            >
              <option value="">{t('automations.editor.anyPerson')}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName}
                </option>
              ))}
            </select>
          )}
          {triggerType === 'mode-changed' && (
            <select
              aria-label={t('automations.editor.modeAria')}
              className={SELECT_CLASS}
              value={triggerMode}
              onChange={(e) => setTriggerMode(e.target.value as HomeMode)}
            >
              {HOME_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABELS[m]}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="space-y-2">
          <label className="flex items-center gap-2 text-kr-sm text-kr-primary">
            <input
              type="checkbox"
              checked={withWindow}
              onChange={(e) => setWithWindow(e.target.checked)}
            />
            {t('automations.editor.windowToggle')}
          </label>
          {withWindow && (
            <div className="space-y-2 rounded-lg border border-kr bg-kr-elevated p-3">
              {dayPicker(
                windowDays,
                (d) => setWindowDays((prev) => toggleIn(prev, d)),
                t('automations.editor.windowDaysAria'),
              )}
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  aria-label={t('automations.editor.fromAria')}
                  value={windowFrom}
                  onChange={(e) => setWindowFrom(e.target.value)}
                />
                <span className="text-kr-xs text-kr-muted">{t('automations.editor.toSep')}</span>
                <Input
                  type="time"
                  aria-label={t('automations.editor.toAria')}
                  value={windowTo}
                  onChange={(e) => setWindowTo(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>{t('automations.editor.thenLabel')}</Label>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setActions((prev) => [...prev, defaultAction(iotDevices, scenes)])}
            >
              {t('automations.editor.addAction')}
            </Button>
          </div>
          <ul className="space-y-2">
            {actions.map((row, i) => (
              <li key={i} className="space-y-2 rounded-lg border border-kr bg-kr-elevated p-3">
                <div className="flex items-center gap-2">
                  <select
                    aria-label={t('automations.editor.actionAria', { n: i + 1 })}
                    className={SELECT_CLASS}
                    value={row.type}
                    onChange={(e) => updateAction(i, { type: e.target.value as ActionType })}
                  >
                    <option value="iot-set">{t('automations.action.iotSet')}</option>
                    <option value="scene-run">{t('automations.action.sceneRun')}</option>
                    <option value="device-block">{t('automations.action.deviceBlock')}</option>
                    <option value="device-pause">{t('automations.action.devicePause')}</option>
                    <option value="notify">{t('automations.action.notify')}</option>
                  </select>
                  {actions.length > 1 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      type="button"
                      aria-label={t('automations.editor.removeActionAria', { n: i + 1 })}
                      onClick={() => setActions((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ✕
                    </Button>
                  )}
                </div>

                {row.type === 'iot-set' && (
                  <div className="flex items-center gap-2">
                    <select
                      aria-label={t('automations.editor.actionDeviceAria', { n: i + 1 })}
                      className={SELECT_CLASS}
                      value={row.deviceId}
                      onChange={(e) => updateAction(i, { deviceId: e.target.value })}
                    >
                      {controllable.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={t('automations.editor.actionStateAria', { n: i + 1 })}
                      className={cn(SELECT_CLASS, 'w-auto')}
                      value={row.on ? 'on' : 'off'}
                      onChange={(e) => updateAction(i, { on: e.target.value === 'on' })}
                    >
                      <option value="on">{t('automations.editor.stateOn')}</option>
                      <option value="off">{t('automations.editor.stateOff')}</option>
                    </select>
                  </div>
                )}
                {row.type === 'scene-run' && (
                  <select
                    aria-label={t('automations.editor.actionSceneAria', { n: i + 1 })}
                    className={SELECT_CLASS}
                    value={row.sceneId}
                    onChange={(e) => updateAction(i, { sceneId: e.target.value })}
                  >
                    {scenes.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                {(row.type === 'device-block' || row.type === 'device-pause') && (
                  <div className="space-y-2">
                    <select
                      aria-label={t('automations.editor.actionTargetAria', { n: i + 1 })}
                      className={SELECT_CLASS}
                      value={row.mac}
                      onChange={(e) => updateAction(i, { mac: e.target.value })}
                    >
                      {eventHasMac && <option value="">{t('automations.editor.eventDevice')}</option>}
                      {networkDevices.map((d) => (
                        <option key={d.mac} value={d.mac}>
                          {networkLabel(d)}
                        </option>
                      ))}
                    </select>
                    {row.type === 'device-pause' && (
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={1440}
                          aria-label={t('automations.editor.actionPauseMinutesAria', { n: i + 1 })}
                          value={row.minutes}
                          onChange={(e) => updateAction(i, { minutes: Number(e.target.value) })}
                          className="w-24"
                        />
                        <span className="text-kr-xs text-kr-muted">{t('automations.editor.minutes')}</span>
                      </div>
                    )}
                  </div>
                )}
                {row.type === 'notify' && (
                  <Input
                    aria-label={t('automations.editor.actionMessageAria', { n: i + 1 })}
                    value={row.message}
                    maxLength={200}
                    placeholder={t('automations.editor.messagePlaceholder')}
                    onChange={(e) => updateAction(i, { message: e.target.value })}
                  />
                )}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center gap-2">
          <Label htmlFor="auto-cooldown" className="text-kr-sm text-kr-secondary">
            {t('automations.editor.cooldownLabel')}
          </Label>
          <Input
            id="auto-cooldown"
            type="number"
            min={1}
            max={1440}
            value={cooldownMin}
            onChange={(e) => setCooldownMin(Number(e.target.value))}
            className="w-20"
          />
          <span className="text-kr-xs text-kr-muted">{t('automations.editor.minutes')}</span>
        </div>
      </div>
    </Slideover>
  );
}

export function AutomationsPage() {
  const t = useT();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [rules, setRules] = useState<AutomationRule[] | null>(null);
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [iotDevices, setIotDevices] = useState<IotDevice[]>([]);
  const [networkDevices, setNetworkDevices] = useState<Device[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  const reload = useCallback(() => {
    void listAutomations()
      .then((list) => {
        setRules(list);
        setError(null);
      })
      .catch((err) => {
        setRules((prev) => prev ?? []);
        setError(describeError(err, t('automations.loadError')));
      });
    void listAutomationRuns()
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);

  useEffect(() => {
    reload();
    void api.get<IotDevice[]>('/iot/devices').then(setIotDevices).catch(() => setIotDevices([]));
    void api
      .get<Device[]>('/inventory/devices')
      .then(setNetworkDevices)
      .catch(() => setNetworkDevices([]));
    void listScenes().then(setScenes).catch(() => setScenes([]));
    void listCameras().then(setCameras).catch(() => setCameras([]));
  }, [reload]);

  // Personas del hogar para los disparadores de presencia (US-169). El listado
  // es admin-only; para el resto (que tampoco ve el editor) se queda vacío.
  useEffect(() => {
    if (!isAdmin) return;
    void api.get<UserSummary[]>('/users').then(setUsers).catch(() => setUsers([]));
  }, [isAdmin]);

  const ctx: NameContext = useMemo(
    () => ({
      devices: iotDevices,
      scenes,
      networkNames: new Map(networkDevices.map((d) => [d.mac, networkLabel(d)])),
      userNames: new Map(users.map((u) => [u.id, u.displayName])),
      cameraNames: new Map(cameras.map((c) => [c.id, c.name])),
    }),
    [iotDevices, scenes, networkDevices, users, cameras],
  );

  const toggleEnabled = async (rule: AutomationRule, enabled: boolean) => {
    try {
      await updateAutomation(rule.id, { enabled });
      reload();
    } catch (err) {
      toast.error(describeError(err, t('automations.toggleError')));
    }
  };

  const ruleName = (id: string) => rules?.find((r) => r.id === id)?.name ?? id;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{t('automations.title')}</h2>
          <p className="text-sm text-muted-foreground">{t('automations.subtitle')}</p>
        </div>
        {isAdmin && (
          <Button
            onClick={() => {
              setEditing(null);
              setEditorOpen(true);
            }}
          >
            {t('automations.new')}
          </Button>
        )}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {rules === null ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : rules.length === 0 ? (
        !error && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-kr bg-kr-surface py-12 text-center">
            <p className="text-kr-secondary">{t('automations.empty.title')}</p>
            <p className="mx-auto max-w-md text-kr-sm text-kr-muted">
              {t('automations.empty.examples')}
            </p>
            {isAdmin && (
              <Button
                onClick={() => {
                  setEditing(null);
                  setEditorOpen(true);
                }}
              >
                {t('automations.empty.create')}
              </Button>
            )}
          </div>
        )
      ) : (
        <ul className="space-y-2">
          {rules.map((rule) => {
            const condition = describeCondition(rule.condition);
            return (
              <li
                key={rule.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-kr bg-kr-surface px-4 py-3"
              >
                <button
                  type="button"
                  disabled={!isAdmin}
                  onClick={() => {
                    setEditing(rule);
                    setEditorOpen(true);
                  }}
                  className="min-w-0 flex-1 text-left disabled:cursor-default"
                >
                  <span className="block truncate text-kr-base font-medium text-kr-primary">
                    {rule.name}
                  </span>
                  <span className="block truncate text-kr-sm text-kr-muted">
                    {t('automations.list.when')}
                    {describeTrigger(rule.trigger, ctx)}
                    {condition ? ` (${condition})` : ''} →{' '}
                    {rule.actions.map((a) => describeAction(a, ctx)).join(' · ')}
                  </span>
                </button>
                {isAdmin && (
                  <Switch
                    checked={rule.enabled}
                    onCheckedChange={(v) => void toggleEnabled(rule, v)}
                    aria-label={t('automations.list.activateAria', { name: rule.name })}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}

      {runs.length > 0 && (
        <section className="space-y-2 border-t border-kr-muted pt-6">
          <h3 className="text-kr-lg font-semibold text-kr-primary">{t('automations.runs.title')}</h3>
          <ul className="divide-y divide-kr-muted overflow-hidden rounded-lg border border-kr">
            {runs.slice(0, 20).map((run) => (
              <li key={run.id} className="flex items-center gap-3 bg-kr-surface px-3 py-2">
                <span aria-hidden className={cn('text-kr-sm', run.ok ? 'text-success' : 'text-danger')}>
                  {run.ok ? '✓' : '✕'}
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-kr-sm text-kr-primary">
                    {ruleName(run.ruleId)} · {run.event}
                  </span>
                  {run.detail && (
                    <span className="block truncate text-kr-xs text-kr-muted">{run.detail}</span>
                  )}
                </div>
                <time className="shrink-0 text-kr-xs text-kr-muted">
                  {new Date(run.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editorOpen && (
        <RuleEditor
          rule={editing}
          iotDevices={iotDevices}
          networkDevices={networkDevices}
          scenes={scenes}
          users={users}
          cameras={cameras}
          onClose={() => setEditorOpen(false)}
          onSaved={reload}
        />
      )}
    </div>
  );
}
