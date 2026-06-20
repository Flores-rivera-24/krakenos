import type { TrafficSample } from '@krakenos/types';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatRate } from '@/lib/format';
import { getSocket } from '@/lib/socket';

const MAX_POINTS = 120;
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--kr-bg-elevated)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '0.5rem',
  fontSize: '0.8rem',
} as const;

/** Gráfica de área rx/tx en tiempo real (vía WebSocket `traffic:sample`). */
export function TrafficWidget() {
  const [samples, setSamples] = useState<TrafficSample[]>([]);

  useEffect(() => {
    let active = true;
    const socket = getSocket();
    void api
      .get<TrafficSample[]>('/traffic/history')
      .then((h) => active && setSamples(h.slice(-MAX_POINTS)))
      .catch(() => undefined);
    const onHistory = (h: TrafficSample[]) => setSamples(h.slice(-MAX_POINTS));
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
        rx: s.rxBytesPerSec,
        tx: s.txBytesPerSec,
      })),
    [samples],
  );

  const last = samples[samples.length - 1];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>Tráfico WAN</CardTitle>
        {last && (
          <span className="text-kr-sm text-kr-secondary">
            ↓ {formatRate(last.rxBytesPerSec)} · ↑ {formatRate(last.txBytesPerSec)}
          </span>
        )}
      </CardHeader>
      <CardContent>
        {data.length < 2 ? (
          <p className="py-12 text-center text-kr-sm text-kr-muted">Esperando muestras…</p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="rx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--kr-accent)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--kr-accent)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="tx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--kr-success)" stopOpacity={0.4} />
                  <stop offset="95%" stopColor="var(--kr-success)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" stroke="var(--kr-text-secondary)" fontSize={11} minTickGap={40} />
              <YAxis
                stroke="var(--kr-text-secondary)"
                fontSize={11}
                tickFormatter={(v: number) => formatRate(v)}
                width={70}
              />
              <Tooltip
                contentStyle={TOOLTIP_STYLE}
                formatter={(v: number) => formatRate(v)}
              />
              <Area type="monotone" dataKey="rx" name="Descarga" stroke="var(--kr-accent)" fill="url(#rx)" />
              <Area type="monotone" dataKey="tx" name="Subida" stroke="var(--kr-success)" fill="url(#tx)" />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
