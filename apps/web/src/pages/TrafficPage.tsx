import type {
  DeviceTrafficStats,
  TrafficRange,
  TrafficSample,
  TrafficStats,
} from '@krakenos/types';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StatCard } from '@/components/dashboard/StatCard';
import { DeviceDetailSlideover } from '@/components/inventory/DeviceDetailSlideover';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorBanner } from '@/components/ui/error-banner';
import { StaleBadge } from '@/components/ui/stale-badge';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { formatBytes, formatRate } from '@/lib/format';
import { isSampleStale, useNow } from '@/lib/realtime';
import { getSocket } from '@/lib/socket';
import { useConnectionStore } from '@/store/connection.store';
import { useInventoryStore } from '@/store/inventory.store';

const MAX_POINTS = 60;

const RANGES: { value: TrafficRange; label: string }[] = [
  { value: 'hour', label: '1h' },
  { value: 'day', label: '24h' },
  { value: 'week', label: '7d' },
];
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
  const [samples, setSamples] = useState<TrafficSample[]>([]);
  const [range, setRange] = useState<TrafficRange>('day');
  const [stats, setStats] = useState<TrafficStats | null>(null);

  // Tráfico por dispositivo (US-46): rango propio + orden + slideover de detalle.
  const [devStats, setDevStats] = useState<DeviceTrafficStats[] | null>(null);
  const [devRange, setDevRange] = useState<TrafficRange>('hour');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [selectedMac, setSelectedMac] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const devices = useInventoryStore((s) => s.devices);
  const subscribe = useInventoryStore((s) => s.subscribe);

  useEffect(() => subscribe(), [subscribe]);

  useEffect(() => {
    let active = true;
    setDevStats(null);
    void api
      .get<DeviceTrafficStats[]>(`/traffic/devices?range=${devRange}`)
      .then((s) => active && setDevStats(s))
      .catch((err) => {
        if (!active) return;
        setDevStats([]);
        setError(describeError(err, 'No se pudo cargar el tráfico'));
      });
    return () => {
      active = false;
    };
  }, [devRange]);

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
      .catch((err) => active && setError(describeError(err, 'No se pudo cargar el tráfico')));
    return () => {
      active = false;
    };
  }, [range]);

  useEffect(() => {
    let active = true;
    const socket = getSocket();

    void api
      .get<TrafficSample[]>('/traffic/history')
      .then((h) => active && setSamples(h))
      .catch((err) => active && setError(describeError(err, 'No se pudo cargar el tráfico')));

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
    return stats.buckets.map((b) => {
      const d = new Date(b.timestamp);
      return {
        t: sameDay
          ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : d.toLocaleDateString([], { weekday: 'short', hour: '2-digit' }),
        rx: +(b.rxBytesPerSec * 8) / 1_000_000,
        tx: +(b.txBytesPerSec * 8) / 1_000_000,
      };
    });
  }, [stats, range]);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">Monitor de tráfico</h2>
        <p className="text-sm text-muted-foreground">Uso de la WAN en tiempo real.</p>
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          title="Descarga"
          value={last ? formatRate(last.rxBytesPerSec) : '—'}
          icon={ArrowDownToLine}
          accent="text-green-500"
          hint="rx"
        />
        <StatCard
          title="Subida"
          value={last ? formatRate(last.txBytesPerSec) : '—'}
          icon={ArrowUpFromLine}
          accent="text-primary"
          hint="tx"
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Ancho de banda (Mbps)</CardTitle>
          {liveStale && <StaleBadge />}
        </CardHeader>
        <CardContent>
          {data.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Esperando muestras…</p>
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
                  name="Descarga"
                  stroke={TRAFFIC_CHART_COLORS.rx}
                  fill="url(#rx)"
                />
                <Area
                  type="monotone"
                  dataKey="tx"
                  name="Subida"
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
          <CardTitle>Histórico</CardTitle>
          <div className="flex gap-1" role="group" aria-label="Rango">
            {RANGES.map((r) => (
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
              <p className="text-muted-foreground">Descargado</p>
              <p className="font-semibold text-green-500">
                {stats ? formatBytes(stats.totalRxBytes) : '—'}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">Subido</p>
              <p className="font-semibold text-primary">
                {stats ? formatBytes(stats.totalTxBytes) : '—'}
              </p>
            </div>
          </div>

          {history.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Sin datos históricos.</p>
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
                  name="Descarga"
                  stroke={TRAFFIC_CHART_COLORS.rx}
                  fill="url(#hrx)"
                />
                <Area
                  type="monotone"
                  dataKey="tx"
                  name="Subida"
                  stroke={TRAFFIC_CHART_COLORS.tx}
                  fill="url(#htx)"
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Tráfico por dispositivo (US-46): solo si el driver lo reporta. */}
      {sortedDev.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Por dispositivo</CardTitle>
            <div className="flex gap-1" role="group" aria-label="Rango por dispositivo">
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
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <caption className="sr-only">Tráfico de red por dispositivo</caption>
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th scope="col" className="py-2 font-medium">
                    Dispositivo
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    IP
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
                      aria-label="Ordenar por descarga total"
                    >
                      ↓ Descarga {sortDir === 'desc' ? '▾' : '▴'}
                    </button>
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    ↑ Subida
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
                      onClick={() => setSelectedMac(d.mac)}
                      className="cursor-pointer border-t border-kr hover:bg-kr-elevated"
                    >
                      <td className="py-2 text-foreground">{name}</td>
                      <td className="py-2 font-mono text-xs text-muted-foreground">
                        {d.ip || '—'}
                      </td>
                      <td className="py-2 text-green-500">{formatBytes(d.rxTotal)}</td>
                      <td className="py-2 text-primary">{formatBytes(d.txTotal)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {selectedDevice && (
        <DeviceDetailSlideover device={selectedDevice} onClose={() => setSelectedMac(null)} />
      )}
    </div>
  );
}
