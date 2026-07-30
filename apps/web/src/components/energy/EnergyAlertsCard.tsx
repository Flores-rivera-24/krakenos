import type { EnergyAlertMetric, EnergyAlertRule, IotDevice } from '@krakenos/types';
import { Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import {
  createEnergyAlert,
  deleteEnergyAlert,
  fetchEnergyAlerts,
} from '@/lib/energy';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { toast } from '@/store/toast.store';

/**
 * Gestión de alertas de consumo por dispositivo (US-183). Solo admin: crea/borra
 * reglas de umbral (potencia sostenida o energía diaria). El canal por el que
 * llega el aviso se elige en Ajustes → Alertas (evento «Consumo eléctrico
 * anómalo», US-180); aquí solo se definen los umbrales.
 */
export function EnergyAlertsCard() {
  const t = useT();
  const [rules, setRules] = useState<EnergyAlertRule[]>([]);
  const [devices, setDevices] = useState<IotDevice[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [metric, setMetric] = useState<EnergyAlertMetric>('sustained-power');
  const [threshold, setThreshold] = useState('');
  const [sustainMinutes, setSustainMinutes] = useState('5');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void fetchEnergyAlerts()
      .then(setRules)
      .catch(() => setRules([]));
    void api
      .get<IotDevice[]>('/iot/devices')
      .then((d) => {
        // Sensores no consumen de forma controlable; se ofrecen luces/enchufes.
        const controllable = d.filter((x) => x.kind !== 'sensor');
        setDevices(controllable);
        if (controllable[0]) setDeviceId(controllable[0].id);
      })
      .catch(() => setDevices([]));
  }, []);

  const nameOf = (id: string): string => devices.find((d) => d.id === id)?.name ?? id;

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(threshold);
    if (!deviceId || !Number.isFinite(value) || value <= 0) {
      toast.error(t('energy.alert.invalid'));
      return;
    }
    setBusy(true);
    try {
      const created = await createEnergyAlert({
        deviceId,
        metric,
        threshold: value,
        sustainMinutes: metric === 'sustained-power' ? Number(sustainMinutes) || 5 : undefined,
      });
      setRules((prev) => [...prev, created]);
      setThreshold('');
      toast.success(t('energy.alert.saved'));
    } catch (err) {
      toast.error(describeError(err, t('energy.alert.error')));
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    try {
      await deleteEnergyAlert(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      toast.error(describeError(err, t('energy.alert.error')));
    }
  }

  function describeRule(r: EnergyAlertRule): string {
    return r.metric === 'sustained-power'
      ? t('energy.alert.describeSustained', { w: r.threshold, min: r.sustainMinutes })
      : t('energy.alert.describeDaily', { wh: r.threshold });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('energy.alert.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rules.length > 0 && (
          <ul className="space-y-2">
            {rules.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-md border border-kr px-3 py-2 text-sm"
              >
                <span>
                  <span className="font-medium text-foreground">{nameOf(r.deviceId)}</span>{' '}
                  <span className="text-muted-foreground">{describeRule(r)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => void onDelete(r.id)}
                  className="text-muted-foreground hover:text-danger"
                  aria-label={t('energy.alert.delete')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={onAdd} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t('energy.alert.device')}</span>
            <select
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              className="rounded-md border border-kr bg-transparent px-2 py-1"
              aria-label={t('energy.alert.device')}
            >
              {devices.length === 0 && <option value="">—</option>}
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">{t('energy.alert.metric')}</span>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as EnergyAlertMetric)}
              className="rounded-md border border-kr bg-transparent px-2 py-1"
              aria-label={t('energy.alert.metric')}
            >
              <option value="sustained-power">{t('energy.alert.sustainedPower')}</option>
              <option value="daily-energy">{t('energy.alert.dailyEnergy')}</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted-foreground">
              {metric === 'sustained-power' ? t('energy.alert.thresholdW') : t('energy.alert.thresholdWh')}
            </span>
            <input
              type="number"
              min="0"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-28 rounded-md border border-kr bg-transparent px-2 py-1"
              aria-label={t('energy.alert.threshold')}
            />
          </label>
          {metric === 'sustained-power' && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">{t('energy.alert.minutes')}</span>
              <input
                type="number"
                min="1"
                value={sustainMinutes}
                onChange={(e) => setSustainMinutes(e.target.value)}
                className="w-20 rounded-md border border-kr bg-transparent px-2 py-1"
                aria-label={t('energy.alert.minutes')}
              />
            </label>
          )}
          <Button type="submit" disabled={busy || devices.length === 0}>
            {t('energy.alert.add')}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">{t('energy.alert.hint')}</p>
      </CardContent>
    </Card>
  );
}
