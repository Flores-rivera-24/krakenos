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
import { api } from '@/lib/api';
import { formatBytes, formatRate } from '@/lib/format';
import { getSocket } from '@/lib/socket';
import { useInventoryStore } from '@/store/inventory.store';

const MAX_POINTS = 60;

const RANGES: { value: TrafficRange; label: string }[] = [
  { value: 'hour', label: '1h' },
  { value: 'day', label: '24h' },
  { value: 'week', label: '7d' },
];
const TOOLTIP_STYLE = {
  backgroundColor: 'hsl(222.2 84% 4.9%)',
  border: '1px solid hsl(217.2 32.6% 17.5%)',
  borderRadius: '0.5rem',
  fontSize: '0.8rem',
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
  const devices = useInventoryStore((s) => s.devices);
  const subscribe = useInventoryStore((s) => s.subscribe);

  useEffect(() => subscribe(), [subscribe]);

  useEffect(() => {
    let active = true;
    setDevStats(null);
    void api
      .get<DeviceTrafficStats[]>(`/traffic/devices?range=${devRange}`)
      .then((s) => active && setDevStats(s))
      .catch(() => active && setDevStats([]));
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
      .catch(() => undefined);
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
      .catch(() => undefined);

    const onHistory = (h: TrafficSample[]) => setSamples(h);
    const onSample = (s: TrafficSample) =>
      setSamples((prev) => [...prev, s].slice(-MAX_POINTS));

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
        <CardHeader>
          <CardTitle>Ancho de banda (Mbps)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Esperando muestras…</p>
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={data}>
                <defs>
                  <linearGradient id="rx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="tx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" stroke="hsl(215 20.2% 65.1%)" fontSize={11} minTickGap={40} />
                <YAxis stroke="hsl(215 20.2% 65.1%)" fontSize={11} width={40} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => `${v.toFixed(1)} Mbps`} />
                <Area type="monotone" dataKey="rx" name="Descarga" stroke="#22c55e" fill="url(#rx)" />
                <Area type="monotone" dataKey="tx" name="Subida" stroke="#0ea5e9" fill="url(#tx)" />
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
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="htx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.6} />
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="t" stroke="hsl(215 20.2% 65.1%)" fontSize={11} minTickGap={40} />
                <YAxis stroke="hsl(215 20.2% 65.1%)" fontSize={11} width={40} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => `${v.toFixed(1)} Mbps`} />
                <Area type="monotone" dataKey="rx" name="Descarga" stroke="#22c55e" fill="url(#hrx)" />
                <Area type="monotone" dataKey="tx" name="Subida" stroke="#0ea5e9" fill="url(#htx)" />
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
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-2 font-medium">Dispositivo</th>
                  <th className="py-2 font-medium">IP</th>
                  <th className="py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      aria-label="Ordenar por descarga total"
                    >
                      ↓ Descarga {sortDir === 'desc' ? '▾' : '▴'}
                    </button>
                  </th>
                  <th className="py-2 font-medium">↑ Subida</th>
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
                      <td className="py-2 font-mono text-xs text-muted-foreground">{d.ip || '—'}</td>
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
