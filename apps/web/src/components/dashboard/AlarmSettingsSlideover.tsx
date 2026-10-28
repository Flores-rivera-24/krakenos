import type { AlarmConfig, Camera, IotDevice, UpdateAlarmConfigRequest } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { WidgetError } from '@/components/ui/widget-error';
import { Callout } from '@/components/ui/callout';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slideover } from '@/components/ui/slideover';
import { Switch } from '@/components/ui/switch';
import { FormError } from '@/components/ui/form-error';
import { getAlarmConfig, updateAlarmConfig } from '@/lib/alarm';
import { api } from '@/lib/api';
import { listCameras } from '@/lib/cameras';
import { describeError } from '@/lib/errors';
import { plural, useT } from '@/lib/i18n';
import { useLectura } from '@/lib/use-lectura';
import { toast } from '@/store/toast.store';
import '@/lib/i18n/catalog/fragments/panel';

interface Props {
  onClose: () => void;
}

function CheckList({
  label,
  items,
  selected,
  onToggle,
  failure,
  unavailable,
}: {
  label: string;
  items: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  /** La lista no se pudo leer: se dice, no se pinta como «sin dispositivos». */
  failure?: string;
  /** La lista no se pudo leer y el fallo ya se dice una vez fuera: aquí no se pinta «sin dispositivos». */
  unavailable?: boolean;
}) {
  const t = useT();
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {failure ? (
        <p role="status" className="text-kr-xs text-kr-secondary">
          {failure}
        </p>
      ) : unavailable ? null : items.length === 0 ? (
        <p className="text-kr-xs text-kr-muted">{t('alarmSettings.noDevices')}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((it) => (
            <li key={it.id}>
              <label className="flex items-center gap-2 text-kr-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(it.id)}
                  onChange={() => onToggle(it.id)}
                />
                {it.name}
              </label>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Config de la alarma (US-188, admin): dispositivos, retardos, auto-armado y PIN. */
export function AlarmSettingsSlideover({ onClose }: Props) {
  const t = useT();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cfg, setCfg] = useState<AlarmConfig | null>(null);
  const [pin, setPin] = useState('');

  // La config manda: si no se lee, no hay nada que guardar. Las listas solo
  // ofrecen qué marcar, y si fallan se dice (no es «sin dispositivos»).
  const lectura = useLectura(async () => {
    let devicesFailed = false;
    let camerasFailed = false;
    const [config, devices, cameras] = await Promise.all([
      getAlarmConfig(),
      api.getList<IotDevice>('/iot/devices').catch(() => {
        devicesFailed = true;
        return [] as IotDevice[];
      }),
      listCameras().catch(() => {
        camerasFailed = true;
        return [] as Camera[];
      }),
    ]);
    return { config, devices, cameras, devicesFailed, camerasFailed };
  }, []);
  const leido = lectura.data;
  // Con el dato leído pero `cfg` aún sin copiar (lo hace el efecto) sigue «cargando».
  const loading = lectura.loading || (leido !== null && !cfg);
  const devices = leido?.devices ?? [];
  const cameras = leido?.cameras ?? [];

  useEffect(() => {
    if (leido) setCfg(leido.config);
  }, [leido]);

  const toggle = (key: 'lightDeviceIds' | 'sensorDeviceIds' | 'cameraIds', id: string) =>
    setCfg((c) =>
      c
        ? {
            ...c,
            [key]: c[key].includes(id) ? c[key].filter((x) => x !== id) : [...c[key], id],
          }
        : c,
    );

  const submit = async () => {
    if (!cfg) return;
    setSaving(true);
    setError(null);
    try {
      const body: UpdateAlarmConfigRequest = {
        sirenDeviceId: cfg.sirenDeviceId,
        lightDeviceIds: cfg.lightDeviceIds,
        sensorDeviceIds: cfg.sensorDeviceIds,
        cameraIds: cfg.cameraIds,
        exitDelaySec: cfg.exitDelaySec,
        entryDelaySec: cfg.entryDelaySec,
        autoArmAway: cfg.autoArmAway,
        ...(pin.length > 0 ? { pin } : {}),
      };
      await updateAlarmConfig(body);
      toast.success(t('alarmSettings.saved'));
      onClose();
    } catch (err) {
      const message = describeError(err, t('alarmSettings.saveError'));
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const plugs = devices.filter((d) => d.kind === 'plug' || d.kind === 'light');
  const lights = devices.filter((d) => d.kind === 'light' || d.kind === 'plug');
  // US-244 partió el `sensor` genérico en categorías propias (`contact`, `smoke`),
  // y esta lista se quedó filtrando solo por la vieja: desde entonces un sensor de
  // apertura **desaparecía** de aquí, así que la alarma no se podía configurar con
  // lo único que la dispara. Se filtra por lo que NO se controla ni mide nada más.
  const sensors = devices.filter(
    (d) => d.kind === 'sensor' || d.kind === 'contact' || d.kind === 'smoke',
  );
  const detectores = devices.filter((d) => d.kind === 'smoke');

  const footer = (
    <div className="space-y-2">
      {error && <FormError>{error}</FormError>}
      <Button onClick={() => void submit()} disabled={saving || !cfg} className="w-full">
        {saving ? t('common.saving') : t('common.save')}
      </Button>
    </div>
  );

  return (
    <Slideover open onClose={onClose} title={t('alarmSettings.title')} footer={footer}>
      {loading ? (
        <p className="text-kr-sm text-kr-secondary">{t('common.loading')}</p>
      ) : !cfg ? (
        <WidgetError message={t('alarmSettings.loadError')} onRetry={lectura.reintentar} />
      ) : (
        <div className="space-y-5">
          <Callout variant="warning" title={t('widget.alarm.disclaimerTitle')}>
            {t('alarmSettings.disclaimer')}
          </Callout>

          {leido?.devicesFailed && (
            <p role="status" className="text-kr-xs text-kr-secondary">
              {t('alarmSettings.devicesLoadError')}
            </p>
          )}

          <div className="space-y-1">
            <Label htmlFor="alarm-siren">{t('alarmSettings.siren')}</Label>
            <select
              id="alarm-siren"
              disabled={leido?.devicesFailed}
              className="w-full rounded-md border border-kr-field bg-kr-surface px-3 py-2 text-base md:text-kr-sm min-h-11 md:min-h-0"
              value={cfg.sirenDeviceId ?? ''}
              onChange={(e) => setCfg({ ...cfg, sirenDeviceId: e.target.value || null })}
            >
              {leido?.devicesFailed && cfg.sirenDeviceId ? (
                <option value={cfg.sirenDeviceId}>{t('alarmSettings.sirenAssigned')}</option>
              ) : (
                <option value="">{t('alarmSettings.none')}</option>
              )}
              {plugs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <CheckList
            label={t('alarmSettings.lights')}
            items={lights}
            selected={cfg.lightDeviceIds}
            onToggle={(id) => toggle('lightDeviceIds', id)}
            unavailable={leido?.devicesFailed}
          />
          <CheckList
            label={t('alarmSettings.sensors')}
            items={sensors}
            selected={cfg.sensorDeviceIds}
            onToggle={(id) => toggle('sensorDeviceIds', id)}
            unavailable={leido?.devicesFailed}
          />

          <Callout variant="info" title={t('alarmSettings.lifeSafety.title')} standing>
            {detectores.length > 0
              ? t('alarmSettings.lifeSafety.count', {
                  n: detectores.length,
                  unidad: plural(detectores.length, {
                    one: t('alarmSettings.lifeSafety.detector'),
                    other: t('alarmSettings.lifeSafety.detectors'),
                  }),
                })
              : ''}
            {t('alarmSettings.lifeSafety.body')}
          </Callout>
          <CheckList
            label={t('alarmSettings.cameras')}
            items={cameras}
            selected={cfg.cameraIds}
            onToggle={(id) => toggle('cameraIds', id)}
            failure={leido?.camerasFailed ? t('alarmSettings.camerasLoadError') : undefined}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="alarm-exit">{t('alarmSettings.exitDelay')}</Label>
              <Input
                id="alarm-exit"
                type="number"
                min={0}
                max={300}
                value={cfg.exitDelaySec}
                onChange={(e) => setCfg({ ...cfg, exitDelaySec: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="alarm-entry">{t('alarmSettings.entryDelay')}</Label>
              <Input
                id="alarm-entry"
                type="number"
                min={0}
                max={300}
                value={cfg.entryDelaySec}
                onChange={(e) => setCfg({ ...cfg, entryDelaySec: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <Label>{t('alarmSettings.autoArm')}</Label>
            <Switch
              checked={cfg.autoArmAway}
              onCheckedChange={(v) => setCfg({ ...cfg, autoArmAway: v })}
              aria-label={t('alarmSettings.autoArmAria')}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="alarm-pin">
              {cfg.hasPin ? t('alarmSettings.pinSet') : t('alarmSettings.pinOptional')}
            </Label>
            <Input
              id="alarm-pin"
              type="password"
              inputMode="numeric"
              placeholder={cfg.hasPin ? '••••' : t('alarmSettings.noPin')}
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              minLength={4}
            />
          </div>
        </div>
      )}
    </Slideover>
  );
}
