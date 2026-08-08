import type { AlarmConfig, Camera, IotDevice, UpdateAlarmConfigRequest } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
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
import { toast } from '@/store/toast.store';

interface Props {
  onClose: () => void;
}

function CheckList({
  label,
  items,
  selected,
  onToggle,
}: {
  label: string;
  items: { id: string; name: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {items.length === 0 ? (
        <p className="text-kr-xs text-kr-muted">Sin dispositivos disponibles.</p>
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<IotDevice[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [cfg, setCfg] = useState<AlarmConfig | null>(null);
  const [pin, setPin] = useState('');

  useEffect(() => {
    let active = true;
    void Promise.all([
      getAlarmConfig(),
      api.getList<IotDevice>('/iot/devices').catch(() => [] as IotDevice[]),
      listCameras().catch(() => [] as Camera[]),
    ])
      .then(([c, d, cams]) => {
        if (!active) return;
        setCfg(c);
        setDevices(d);
        setCameras(cams);
      })
      .catch((err) => active && setError(describeError(err, 'No se pudo cargar la configuración')))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

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
      toast.success('Ajustes de alarma guardados');
      onClose();
    } catch (err) {
      const message = describeError(err, 'No se pudo guardar');
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
      <Button onClick={() => void submit()} disabled={saving || loading} className="w-full">
        {saving ? 'Guardando…' : 'Guardar'}
      </Button>
    </div>
  );

  return (
    <Slideover open onClose={onClose} title="Ajustes de alarma" footer={footer}>
      {loading || !cfg ? (
        <p className="text-kr-sm text-kr-secondary">Cargando…</p>
      ) : (
        <div className="space-y-5">
          <Callout variant="warning" title="No sustituye una alarma certificada">
            La alarma del hogar es un extra de aviso, no un sistema de seguridad profesional: no tiene
            batería de respaldo ni conexión de emergencia por red móvil, y deja de funcionar si se va
            la luz o se apaga el servidor. No la uses como tu única protección.
          </Callout>

          <div className="space-y-1">
            <Label htmlFor="alarm-siren">Sirena (enchufe que se enciende al disparar)</Label>
            <select
              id="alarm-siren"
              className="w-full rounded-md border border-kr bg-kr-surface px-3 py-2 text-kr-sm"
              value={cfg.sirenDeviceId ?? ''}
              onChange={(e) => setCfg({ ...cfg, sirenDeviceId: e.target.value || null })}
            >
              <option value="">Ninguna</option>
              {plugs.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </div>

          <CheckList
            label="Luces que se encienden al disparar"
            items={lights}
            selected={cfg.lightDeviceIds}
            onToggle={(id) => toggle('lightDeviceIds', id)}
          />
          <CheckList
            label="Sensores vigilados (apertura, movimiento, humo)"
            items={sensors}
            selected={cfg.sensorDeviceIds}
            onToggle={(id) => toggle('sensorDeviceIds', id)}
          />

          <Callout variant="info" title="El humo y el CO avisan siempre" standing>
            {detectores.length === 1
              ? 'Tienes 1 detector de humo o CO. '
              : detectores.length > 1
                ? `Tienes ${detectores.length} detectores de humo o CO. `
                : ''}
            Un detector de humo o CO avisa aunque la alarma esté desarmada y aunque no esté marcado
            arriba: de noche, con la casa llena, es cuando más importa. Marcarlo aquí añade la sirena
            y las luces cuando la alarma esté armada.
          </Callout>
          <CheckList
            label="Cámaras que arman el disparo"
            items={cameras}
            selected={cfg.cameraIds}
            onToggle={(id) => toggle('cameraIds', id)}
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="alarm-exit">Retardo de salida (s)</Label>
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
              <Label htmlFor="alarm-entry">Retardo de entrada (s)</Label>
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
            <Label>Armar sola al salir de casa (modo Fuera)</Label>
            <Switch
              checked={cfg.autoArmAway}
              onCheckedChange={(v) => setCfg({ ...cfg, autoArmAway: v })}
              aria-label="Armar sola al salir de casa"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="alarm-pin">
              PIN de desarme {cfg.hasPin ? '(configurado — escribe para cambiarlo)' : '(opcional)'}
            </Label>
            <Input
              id="alarm-pin"
              type="password"
              inputMode="numeric"
              placeholder={cfg.hasPin ? '••••' : 'sin PIN'}
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
