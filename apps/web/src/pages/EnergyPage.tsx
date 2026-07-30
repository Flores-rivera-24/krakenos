import type { EnergyRange, EnergyStats } from '@krakenos/types';
import { Coins, Download, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StatCard } from '@/components/dashboard/StatCard';
import { EnergyAlertsCard } from '@/components/energy/EnergyAlertsCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import {
  ENERGY_RANGES,
  fetchEnergyConfig,
  fetchEnergyStats,
  formatCost,
  formatEnergy,
  percentChange,
  saveEnergyConfig,
} from '@/lib/energy';
import { describeError } from '@/lib/errors';
import { useT } from '@/lib/i18n';
import { downloadReport } from '@/lib/reports';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';

const CHART_COLORS = {
  bar: 'var(--kr-accent)',
  axis: 'var(--kr-text-secondary)',
} as const;

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--kr-bg-surface)',
  border: '1px solid var(--kr-border)',
  borderRadius: '0.5rem',
  fontSize: '0.8rem',
  color: 'var(--kr-text-primary)',
} as const;

export function EnergyPage() {
  const t = useT();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';

  const [range, setRange] = useState<EnergyRange>('day');
  const [stats, setStats] = useState<EnergyStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Formulario de precio (solo admin).
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('€');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    setStats(null);
    void fetchEnergyStats(range)
      .then((s) => active && setStats(s))
      .catch((err) => active && setError(describeError(err, t('energy.loadError'))));
    return () => {
      active = false;
    };
  }, [range]);

  useEffect(() => {
    let active = true;
    void fetchEnergyConfig()
      .then((c) => {
        if (!active) return;
        setPrice(c.pricePerKwh === null ? '' : String(c.pricePerKwh));
        setCurrency(c.currency);
      })
      .catch(() => {
        /* el precio es opcional; un fallo aquí no bloquea el panel */
      });
    return () => {
      active = false;
    };
  }, []);

  const chartData = useMemo(() => {
    if (!stats) return [];
    const label = (iso: string): string => {
      const d = new Date(iso);
      if (range === 'day') return d.toLocaleTimeString([], { hour: '2-digit' });
      return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
    };
    return stats.buckets.map((b) => ({ t: label(b.timestamp), kwh: +(b.energyWh / 1000).toFixed(3) }));
  }, [stats, range]);

  const change = stats ? percentChange(stats.totalEnergyWh, stats.previousTotalEnergyWh) : null;

  async function onSavePrice(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const trimmed = price.trim();
      const pricePerKwh = trimmed === '' ? null : Number(trimmed);
      const updated = await saveEnergyConfig({ pricePerKwh, currency: currency.trim() || '€' });
      setPrice(updated.pricePerKwh === null ? '' : String(updated.pricePerKwh));
      setCurrency(updated.currency);
      // Recarga las estadísticas para que el coste refleje el nuevo precio.
      setStats(await fetchEnergyStats(range));
      toast.success(t('energy.priceSaved'));
    } catch (err) {
      toast.error(describeError(err, t('energy.priceError')));
    } finally {
      setSaving(false);
    }
  }

  function downloadCsv() {
    void downloadReport(`/reports/energy.csv?range=${range}`, 'krakenos-energia.csv').catch((err) =>
      toast.error(describeError(err, t('energy.loadError'))),
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">{t('energy.title')}</h2>
        <p className="text-sm text-muted-foreground">{t('energy.subtitle')}</p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          title={t('energy.totalConsumption')}
          value={stats ? formatEnergy(stats.totalEnergyWh) : '—'}
          icon={Zap}
          accent="text-warning"
        />
        <StatCard
          title={t('energy.estimatedCost')}
          value={stats ? formatCost(stats.totalCost, stats.currency) : '—'}
          icon={Coins}
          accent="text-primary"
        />
        <StatCard
          title={t('energy.vsPrevious')}
          value={change === null ? '—' : `${change > 0 ? '+' : ''}${change}%`}
          icon={change !== null && change > 0 ? TrendingUp : TrendingDown}
          accent={change !== null && change > 0 ? 'text-danger' : 'text-success'}
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>{t('energy.consumptionChart')}</CardTitle>
          <div className="flex items-center gap-2">
            <div className="flex gap-1" role="group" aria-label={t('energy.rangeLabel')}>
              {ENERGY_RANGES.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setRange(r.value)}
                  aria-pressed={range === r.value}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    range === r.value
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={downloadCsv} aria-label={t('energy.exportCsv')}>
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">{t('energy.noData')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData}>
                <XAxis dataKey="t" stroke={CHART_COLORS.axis} fontSize={11} minTickGap={20} />
                <YAxis stroke={CHART_COLORS.axis} fontSize={11} width={44} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => `${v} kWh`} />
                <Bar dataKey="kwh" name={t('energy.consumption')} fill={CHART_COLORS.bar} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('energy.byDevice')}</CardTitle>
        </CardHeader>
        <CardContent>
          {!stats || stats.devices.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t('energy.noDevices')}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('energy.byDevice')}</caption>
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th scope="col" className="py-2 font-medium">
                      {t('energy.col.device')}
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      {t('energy.col.room')}
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      {t('energy.col.energy')}
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      {t('energy.col.cost')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.devices.map((d) => (
                    <tr key={d.deviceId} className="border-t border-kr">
                      <td className="py-2 text-foreground">{d.name ?? d.deviceId}</td>
                      <td className="py-2 text-muted-foreground">{d.room ?? '—'}</td>
                      <td className="py-2 text-warning">{formatEnergy(d.energyWh)}</td>
                      <td className="py-2 text-primary">{formatCost(d.cost, stats.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {isAdmin && <EnergyAlertsCard />}

      {isAdmin && (
        <Card>
          <CardHeader>
            <CardTitle>{t('energy.priceTitle')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSavePrice} className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('energy.pricePerKwh')}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0.15"
                  className="w-32 rounded-md border border-kr bg-transparent px-2 py-1"
                  aria-label={t('energy.pricePerKwh')}
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-muted-foreground">{t('energy.currency')}</span>
                <input
                  type="text"
                  maxLength={8}
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="w-20 rounded-md border border-kr bg-transparent px-2 py-1"
                  aria-label={t('energy.currency')}
                />
              </label>
              <Button type="submit" disabled={saving}>
                {t('energy.savePrice')}
              </Button>
            </form>
            <p className="mt-2 text-xs text-muted-foreground">{t('energy.priceHint')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
