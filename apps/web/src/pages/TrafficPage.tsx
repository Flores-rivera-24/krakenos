import type {
  DeviceTrafficReport,
  DeviceTrafficStats,
  PerDeviceTrafficCapability,
  TrafficRange,
  TrafficSample,
  TrafficStats,
} from '@krakenos/types';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StatCard } from '@/components/dashboard/StatCard';
import { DeviceDetailSlideover } from '@/components/inventory/DeviceDetailSlideover';
import { WellbeingCard } from '@/components/wellbeing/WellbeingCard';
import { Callout } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { StaleBadge } from '@/components/ui/stale-badge';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatBytes, formatRate } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { isSampleStale, useNow } from '@/lib/realtime';
import { getSocket } from '@/lib/socket';
import { useAuthStore } from '@/store/auth.store';
import { useConnectionStore } from '@/store/connection.store';
import { useInventoryStore } from '@/store/inventory.store';
import { filaAbrible } from '@/lib/a11y';
import { PerDeviceTrafficNotice } from '@/components/traffic/PerDeviceTrafficNotice';

const MAX_POINTS = 60;

const RANGES: { value: TrafficRange; label: string }[] = [
  { value: 'hour', label: '1h' },
  { value: 'day', label: '24h' },
  { value: 'week', label: '7d' },
];
// El gráfico WAN admite además el rango mensual (US-113). El desglose por
// dispositivo se queda en 7 días (consultar un mes por MAC sería muy pesado).
const WAN_RANGES: { value: TrafficRange; label: string }[] = [...RANGES, { value: 'month', label: '30d' }];
/**
 * Colores de las gráficas leídos de los tokens del tema (US-57): al ser
 * `var(--kr-*)`, cambian automáticamente al togglear claro/oscuro en vez de
 * hardcodear hex/HSL. `rx`=descarga (success), `tx`=subida (info).
 */
export const TRAFFIC_CHART_COLORS = {
  rx: 'var(--kr-success)',
  tx: 'var(--kr-info)',
  axis: 'var(--kr-text-secondary)',
} as const;

export const TOOLTIP_STYLE = {
  backgroundColor: 'var(--kr-bg-surface)',
  border: '1px solid var(--kr-border)',
  borderRadius: '0.5rem',
  fontSize: '0.8rem',
  color: 'var(--kr-text-primary)',
} as const;

export function TrafficPage() {
  const t = useT();
  const [samples, setSamples] = useState<TrafficSample[]>([]);
  const [range, setRange] = useState<TrafficRange>('day');
  const [stats, setStats] = useState<TrafficStats | null>(null);

  // Tráfico por dispositivo (US-46): rango propio + orden + slideover de detalle.
  const [devStats, setDevStats] = useState<DeviceTrafficStats[] | null>(null);
  // US-251: la capacidad tiene tres estados. Se asume disponible hasta saber lo
  // contrario, para no acusar al router mientras carga.
  const [perDevice, setPerDevice] = useState<PerDeviceTrafficCapability>({ status: 'supported' });
  const [devRange, setDevRange] = useState<TrafficRange>('hour');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [selectedMac, setSelectedMac] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const devices = useInventoryStore((s) => s.devices);
  const subscribe = useInventoryStore((s) => s.subscribe);
  /**
   * US-250: el desglose por dispositivo exige `home.activity` (solo admin). No hace
   * falta un tercer estado para «rol aún sin cargar»: `App` no monta ninguna ruta
   * hasta que `bootstrapSession()` resuelve y `RequireAuth` redirige al login sin
   * usuario, así que cuando esta página se monta el rol ya está resuelto.
   */
  const activityDenied = useAuthStore((s) => s.user?.role !== 'admin');

  useEffect(() => subscribe(), [subscribe]);

  useEffect(() => {
    if (activityDenied) {
      // Ni se pide: la tarjeta lo explica. Pedir para enseñar el error sería
      // enseñarle al usuario un fallo que no lo es.
      setDevStats([]);
      return;
    }
    let active = true;
    setDevStats(null);
    void api
      .get<DeviceTrafficReport>(`/traffic/devices?range=${devRange}`)
      .then((r) => {
        if (!active) return;
        setDevStats(r?.devices ?? []);
        setPerDevice(r?.perDeviceTraffic ?? { status: 'supported' });
      })
      .catch((err) => {
        if (!active) return;
        setDevStats([]);
        setError(describeError(err, t('traffic.loadError')));
      });
    return () => {
      active = false;
    };
  }, [devRange, activityDenied]);

  const deviceByMac = useMemo(() => {
    const map: Record<string, (typeof devices)[string]> = {};
    for (const d of Object.values(devices)) map[d.mac.toLowerCase()] = d;
    return map;
  }, [devices]);

  const sortedDev = useMemo(() => {
    if (!devStats) return [];
    return [...devStats].sort((a, b) =>
      sortDir === 'desc' ? b.rxTotal - a.rxTotal : a.rxTotal - b.rxTotal,
    );
  }, [devStats, sortDir]);

  const selectedDevice = selectedMac ? (deviceByMac[selectedMac.toLowerCase()] ?? null) : null;

  useEffect(() => {
    let active = true;
    setStats(null);
    void api
      .get<TrafficStats>(`/traffic/stats?range=${range}`)
      .then((s) => active && setStats(s))
      .catch((err) => active && setError(describeError(err, t('traffic.loadError'))));
    return () => {
      active = false;
    };
  }, [range]);

  useEffect(() => {
    let active = true;
    const socket = getSocket();

    void api
      .getList<TrafficSample>('/traffic/history')
      .then((h) => active && setSamples(h))
      .catch((err) => active && setError(describeError(err, t('traffic.loadError'))));

    const onHistory = (h: TrafficSample[]) => setSamples(h);
    const onSample = (s: TrafficSample) => setSamples((prev) => [...prev, s].slice(-MAX_POINTS));

    socket.on('traffic:history', onHistory);
    socket.on('traffic:sample', onSample);
    return () => {
      active = false;
      socket.off('traffic:history', onHistory);
      socket.off('traffic:sample', onSample);
    };
  }, []);

  const data = useMemo(
    () =>
      samples.map((s) => ({
        t: new Date(s.timestamp).toLocaleTimeString([], { minute: '2-digit', second: '2-digit' }),
        rx: +(s.rxBytesPerSec * 8) / 1_000_000,
        tx: +(s.txBytesPerSec * 8) / 1_000_000,
      })),
    [samples],
  );

  const last = samples.at(-1);

  // El panel en vivo está obsoleto si el stream está caído o la última muestra
  // dejó de refrescarse (datos congelados, US-94).
  const connected = useConnectionStore((s) => s.status) === 'connected';
  const now = useNow();
  const liveStale = !!last && (!connected || isSampleStale(last.timestamp, now));

  const history = useMemo(() => {
    if (!stats) return [];
    const sameDay = range === 'hour' || range === 'day';
    const label = (d: Date): string => {
      if (sameDay) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      // Mes (buckets diarios): fecha corta; semana: día + hora.
      if (range === 'month') return d.toLocaleDateString([], { day: '2-digit', month: 'short' });
      return d.toLocaleDateString([], { weekday: 'short', hour: '2-digit' });
    };
    return stats.buckets.map((b) => {
      const d = new Date(b.timestamp);
      return {
        t: label(d),
        rx: +(b.rxBytesPerSec * 8) / 1_000_000,
        tx: +(b.txBytesPerSec * 8) / 1_000_000,
      };
    });
  }, [stats, range]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">{t('traffic.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('traffic.subtitle')}</p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          title={t('traffic.download')}
          value={last ? formatRate(last.rxBytesPerSec) : '—'}
          icon={ArrowDownToLine}
          accent="text-success"
          hint="rx"
        />
        <StatCard
          title={t('traffic.upload')}
          value={last ? formatRate(last.txBytesPerSec) : '—'}
          icon={ArrowUpFromLine}
          accent="text-primary"
          hint="tx"
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>{t('traffic.bandwidth')}</CardTitle>
          {liveStale && <StaleBadge />}
        </CardHeader>
        <CardContent>
          {data.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t('traffic.waiting')}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="rx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={TRAFFIC_CHART_COLORS.rx} stopOpacity={0.6} />
                    <stop offset="95%" stopColor={TRAFFIC_CHART_COLORS.rx} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="tx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={TRAFFIC_CHART_COLORS.tx} stopOpacity={0.6} />
                    <stop offset="95%" stopColor={TRAFFIC_CHART_COLORS.tx} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="t"
                  stroke={TRAFFIC_CHART_COLORS.axis}
                  fontSize={11}
                  minTickGap={40}
                />
                <YAxis stroke={TRAFFIC_CHART_COLORS.axis} fontSize={11} width={40} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => `${v.toFixed(1)} Mbps`}
                />
                <Area
                  type="monotone"
                  dataKey="rx"
                  name={t('traffic.download')}
                  stroke={TRAFFIC_CHART_COLORS.rx}
                  fill="url(#rx)"
                />
                <Area
                  type="monotone"
                  dataKey="tx"
                  name={t('traffic.upload')}
                  stroke={TRAFFIC_CHART_COLORS.tx}
                  fill="url(#tx)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>{t('traffic.history')}</CardTitle>
          <div className="flex gap-1" role="group" aria-label={t('traffic.rangeLabel')}>
            {WAN_RANGES.map((r) => (
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
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">{t('traffic.totalDownloaded')}</p>
              <p className="font-semibold text-success">
                {stats ? formatBytes(stats.totalRxBytes) : '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">{t('traffic.totalUploaded')}</p>
              <p className="font-semibold text-primary">
                {stats ? formatBytes(stats.totalTxBytes) : '—'}
              </p>
            </div>
          </div>

          {history.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              {t('traffic.noHistory')}
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={history}>
                <defs>
                  <linearGradient id="hrx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={TRAFFIC_CHART_COLORS.rx} stopOpacity={0.6} />
                    <stop offset="95%" stopColor={TRAFFIC_CHART_COLORS.rx} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="htx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={TRAFFIC_CHART_COLORS.tx} stopOpacity={0.6} />
                    <stop offset="95%" stopColor={TRAFFIC_CHART_COLORS.tx} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="t"
                  stroke={TRAFFIC_CHART_COLORS.axis}
                  fontSize={11}
                  minTickGap={40}
                />
                <YAxis stroke={TRAFFIC_CHART_COLORS.axis} fontSize={11} width={40} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: number) => `${v.toFixed(1)} Mbps`}
                />
                <Area
                  type="monotone"
                  dataKey="rx"
                  name={t('traffic.download')}
                  stroke={TRAFFIC_CHART_COLORS.rx}
                  fill="url(#hrx)"
                />
                <Area
                  type="monotone"
                  dataKey="tx"
                  name={t('traffic.upload')}
                  stroke={TRAFFIC_CHART_COLORS.tx}
                  fill="url(#htx)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Tráfico por dispositivo (US-46). Si el driver NO lo reporta, la tarjeta se
          muestra igualmente con la explicación: antes desaparecía sin más y el
          usuario nunca se enteraba de por qué su bienestar digital estaba vacío
          (US-263). Si sí lo reporta pero aún no hay datos, no hay nada que decir. */}
      {(sortedDev.length > 0 ||
        activityDenied ||
        (devStats !== null && perDevice.status !== 'supported')) && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>{t('traffic.byDevice')}</CardTitle>
            {/* Sin permiso no hay nada que acotar por rango: el selector sobra. */}
            {!activityDenied && (
              <div className="flex gap-1" role="group" aria-label={t('traffic.deviceRangeLabel')}>
                {RANGES.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setDevRange(r.value)}
                    aria-pressed={devRange === r.value}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      devRange === r.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {activityDenied ? (
              /* La tarjeta se muestra diciendo por qué está vacía, en vez de
                 desaparecer (US-263): que falte sin explicación se lee como un
                 fallo. Y el motivo no es del router ni del usuario, así que no se
                 le pide que arregle nada — se le dice quién puede verlo. */
              <Callout variant="info" standing title={t('traffic.perDeviceAdminOnly')}>
                {t('traffic.perDeviceAdminOnlyDesc')}
              </Callout>
            ) : perDevice.status !== 'supported' ? (
              <PerDeviceTrafficNotice
                capability={perDevice}
                unsupportedTitle={t('traffic.perDeviceUnsupported')}
                unsupportedDesc={t('traffic.perDeviceUnsupportedDesc')}
              />
            ) : (
            /* Scroll horizontal en móvil en vez de desbordar la página (US-97). */
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">{t('traffic.deviceCaption')}</caption>
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th scope="col" className="py-2 font-medium">
                      {t('traffic.col.device')}
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      {t('traffic.col.ip')}
                    </th>
                    <th
                      scope="col"
                      aria-sort={sortDir === 'desc' ? 'descending' : 'ascending'}
                      className="py-2 font-medium"
                    >
                      <button
                        type="button"
                        onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        aria-label={t('traffic.sortLabel')}
                      >
                        {t('traffic.col.download')} {sortDir === 'desc' ? '▾' : '▴'}
                      </button>
                    </th>
                    <th scope="col" className="py-2 font-medium">
                      {t('traffic.col.upload')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedDev.map((d) => {
                    const dev = deviceByMac[d.mac.toLowerCase()];
                    const name = d.label ?? dev?.hostname ?? d.mac;
                    return (
                      <tr
                        key={d.mac}
                        {...filaAbrible(() => setSelectedMac(d.mac), `Ver ${name}`)}
                        className="cursor-pointer border-t border-kr hover:bg-kr-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-kr-accent"
                      >
                        <td className="py-2 text-foreground">{name}</td>
                        <td className="py-2 font-mono text-xs text-muted-foreground">
                          {d.ip || '—'}
                        </td>
                        <td className="py-2 text-success">{formatBytes(d.rxTotal)}</td>
                        <td className="py-2 text-primary">{formatBytes(d.txTotal)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Bienestar digital (US-184): uso de internet por persona, privacidad por rol. */}
      <WellbeingCard />

      {selectedDevice && (
        <DeviceDetailSlideover device={selectedDevice} onClose={() => setSelectedMac(null)} />
      )}
    </div>
  );
}
