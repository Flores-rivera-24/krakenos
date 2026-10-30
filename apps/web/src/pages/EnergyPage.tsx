import type { EnergyRange } from '@krakenos/types';
import { Coins, Download, TrendingDown, TrendingUp, Zap, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StatCard } from '@/components/dashboard/StatCard';
import { EnergyAlertsCard } from '@/components/energy/EnergyAlertsCard';
import { Button } from '@/components/ui/button';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { FormError } from '@/components/ui/form-error';
import { LoadingStatCard } from '@/components/ui/loading-stat-card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ENERGY_RANGES,
  fetchEnergyConfig,
  fetchEnergyStats,
  energyIn,
  energyUnitFor,
  formatCost,
  formatEnergy,
  formatEnergyIn,
  formatEnergyTick,
  percentChange,
  saveEnergyConfig,
} from '@/lib/energy';
import { describeError } from '@/lib/errors';
import { formatDate, formatTime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useLectura } from '@/lib/use-lectura';
import { downloadReport } from '@/lib/reports';
import { useAuthStore } from '@/store/auth.store';
import { toast } from '@/store/toast.store';
import { DomainGate } from '@/components/integrations/DomainNotice';
import '@/lib/i18n/catalog/fragments/energia';

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

/** Cifra de arriba: mientras llega el dato, un esqueleto; «—» solo si no hay dato que dar. */
function EnergyStat({
  loading,
  ...props
}: {
  loading: boolean;
  title: string;
  value: string;
  icon: LucideIcon;
  accent: string;
}) {
  return loading ? <LoadingStatCard {...props} /> : <StatCard {...props} />;
}

function EnergyPageBody() {
  const t = useT();
  const role = useAuthStore((s) => s.user?.role);
  const isAdmin = role === 'admin';

  const [range, setRange] = useState<EnergyRange>('day');
  const {
    data: stats,
    failed: statsFailed,
    loading: statsLoading,
    reintentar: reintentarStats,
    setData: setStats,
  } = useLectura(() => fetchEnergyStats(range), [range]);

  // Formulario de precio (solo admin).
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState('€');
  const [saving, setSaving] = useState(false);

  // El precio es opcional para el panel, pero si no se pudo leer el formulario no
  // puede ofrecerse vacío: guardar así borraría el precio que sí hay.
  const {
    data: config,
    failed: configFailed,
    loading: configLoading,
    reintentar: reintentarConfig,
  } = useLectura(fetchEnergyConfig, []);
  useEffect(() => {
    if (!config) return;
    setPrice(config.pricePerKwh === null ? '' : String(config.pricePerKwh));
    setCurrency(config.currency);
  }, [config]);

  // Misma unidad que la tarjeta de total (`formatEnergy(stats.totalEnergyWh)`):
  // el eje y la cifra de arriba se leen en la misma escala.
  const unit = energyUnitFor(stats?.totalEnergyWh ?? 0);

  const chartData = useMemo(() => {
    if (!stats) return [];
    const label = (iso: string): string => {
      const d = new Date(iso);
      if (range === 'day') return formatTime(d, { hour: '2-digit' });
      return formatDate(d, { day: '2-digit', month: 'short' });
    };
    return stats.buckets.map((b) => ({
      t: label(b.timestamp),
      value: energyIn(b.energyWh, unit),
    }));
  }, [stats, range, unit]);

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
        <h1 className="text-kr-xl font-semibold text-kr-primary">{t('energy.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('energy.subtitle')}</p>
      </div>

      {statsFailed && !stats && (
        <ErrorBanner>
          {t('energy.loadError')}
          <button type="button" onClick={reintentarStats} className="text-kr-link hover:underline">
            {t('ui.retry')}
          </button>
        </ErrorBanner>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <EnergyStat
          loading={statsLoading}
          title={t('energy.totalConsumption')}
          value={stats ? formatEnergy(stats.totalEnergyWh) : '—'}
          icon={Zap}
          accent="text-warning"
        />
        <EnergyStat
          loading={statsLoading}
          title={t('energy.estimatedCost')}
          value={stats ? formatCost(stats.totalCost, stats.currency) : '—'}
          icon={Coins}
          accent="text-primary"
        />
        <EnergyStat
          loading={statsLoading}
          title={t('energy.vsPrevious')}
          value={change === null ? '—' : `${change > 0 ? '+' : ''}${change}%`}
          icon={change !== null && change > 0 ? TrendingUp : TrendingDown}
          accent={change !== null && change > 0 ? 'text-danger' : 'text-success'}
        />
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0">
          <CardTitle>{t('energy.consumptionChart', { unit })}</CardTitle>
          <div className="flex items-center gap-2">
            <SegmentedControl
              options={ENERGY_RANGES}
              value={range}
              onChange={setRange}
              aria-label={t('energy.rangeLabel')}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={downloadCsv}
              aria-label={t('energy.exportCsv')}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {statsLoading ? (
            <Skeleton className="h-[260px] w-full" />
          ) : !stats ? null : chartData.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">{t('energy.noData')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData}>
                <XAxis dataKey="t" stroke={CHART_COLORS.axis} fontSize={11} minTickGap={20} />
                <YAxis
                  stroke={CHART_COLORS.axis}
                  fontSize={11}
                  width={52}
                  tickFormatter={(v: number) => formatEnergyTick(v, unit)}
                />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => formatEnergyIn(unit === 'kWh' ? v * 1000 : v, unit)}
                />
                <Bar
                  dataKey="value"
                  name={t('energy.consumption')}
                  fill={CHART_COLORS.bar}
                  radius={[3, 3, 0, 0]}
                />
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
          {statsLoading ? (
            <div className="space-y-2 py-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : !stats ? null : stats.devices.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t('energy.noDevices')}
            </p>
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
                      <td className="py-2 text-kr-link">{formatCost(d.cost, stats.currency)}</td>
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
                  className="w-32 rounded-md border border-kr-field bg-transparent px-2 py-1 text-base md:text-sm min-h-11 md:min-h-0"
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
                  className="w-20 rounded-md border border-kr-field bg-transparent px-2 py-1 text-base md:text-sm min-h-11 md:min-h-0"
                  aria-label={t('energy.currency')}
                />
              </label>
              <Button type="submit" disabled={saving || configLoading || configFailed}>
                {t('energy.savePrice')}
              </Button>
            </form>
            {configFailed && !config && (
              <div className="mt-2 flex items-center gap-3">
                <FormError>{t('energy.priceLoadError')}</FormError>
                <button
                  type="button"
                  onClick={reintentarConfig}
                  className="text-kr-sm text-kr-link hover:underline"
                >
                  {t('ui.retry')}
                </button>
              </div>
            )}
            <p className="mt-2 text-xs text-muted-foreground">{t('energy.priceHint')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * La página del dominio `iot` con su estado: «sin configurar» sustituye al cuerpo y
 * «demostración» lo avisa encima (ver `DomainGate`).
 */
export function EnergyPage() {
  const t = useT();
  return (
    <DomainGate domain="iot" title={t('energy.title')}>
      <EnergyPageBody />
    </DomainGate>
  );
}
