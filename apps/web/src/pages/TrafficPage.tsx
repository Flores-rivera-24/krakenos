import type { TrafficSample } from '@krakenos/types';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StatCard } from '@/components/dashboard/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatRate } from '@/lib/format';
import { getSocket } from '@/lib/socket';

const MAX_POINTS = 60;
const TOOLTIP_STYLE = {
  backgroundColor: 'hsl(222.2 84% 4.9%)',
  border: '1px solid hsl(217.2 32.6% 17.5%)',
  borderRadius: '0.5rem',
  fontSize: '0.8rem',
} as const;

export function TrafficPage() {
  const [samples, setSamples] = useState<TrafficSample[]>([]);

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
    </div>
  );
}
