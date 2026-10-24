import type { TrafficSample } from '@krakenos/types';
import { useEffect, useMemo, useState } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { StaleBadge } from '@/components/ui/stale-badge';
import { WidgetError } from '@/components/ui/widget-error';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatRate, formatRateCompact, formatTime } from '@/lib/format';
import { getSocket } from '@/lib/socket';
import { useT } from '@/lib/i18n';
import '@/lib/i18n/catalog/fragments/panel';

const MAX_POINTS = 120;
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--kr-bg-elevated)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: '0.5rem',
  fontSize: '0.8rem',
} as const;

/** Gráfica de área rx/tx en tiempo real (vía WebSocket `traffic:sample`). */
export function TrafficWidget() {
  const t = useT();
  const [samples, setSamples] = useState<TrafficSample[]>([]);
  // Un fallo del historial no es «esperando muestras»; lo que llega por socket lo limpia.
  const [failed, setFailed] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let active = true;
    const socket = getSocket();
    void api
      .getList<TrafficSample>('/traffic/history')
      .then((h) => {
        if (!active) return;
        setSamples(h.slice(-MAX_POINTS));
        setFailed(false);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    const onHistory = (h: TrafficSample[]) => {
      setSamples(h.slice(-MAX_POINTS));
      setFailed(false);
    };
    const onSample = (s: TrafficSample) => {
      setSamples((prev) => [...prev, s].slice(-MAX_POINTS));
      setFailed(false);
    };
    socket.on('traffic:history', onHistory);
    socket.on('traffic:sample', onSample);
    return () => {
      active = false;
      socket.off('traffic:history', onHistory);
      socket.off('traffic:sample', onSample);
    };
  }, [intento]);

  const data = useMemo(
    () =>
      samples.map((s) => ({
        t: formatTime(s.timestamp, { minute: '2-digit', second: '2-digit' }),
        rx: s.rxBytesPerSec,
        tx: s.txBytesPerSec,
      })),
    [samples],
  );

  const last = samples[samples.length - 1];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>{t('widget.traffic.title')}</CardTitle>
        {last && (
          <span className="text-kr-sm text-kr-secondary">
            ↓ {formatRate(last.rxBytesPerSec)} · ↑ {formatRate(last.txBytesPerSec)}
          </span>
        )}
      </CardHeader>
      <CardContent>
        {failed && samples.length > 0 && <StaleBadge className="mb-2" />}
        {failed && data.length < 2 ? (
          <WidgetError
            message={t('widget.traffic.error')}
            onRetry={() => setIntento((n) => n + 1)}
          />
        ) : data.length < 2 ? (
          <p className="py-12 text-center text-kr-sm text-kr-muted">
            {t('widget.traffic.waiting')}
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
                tickFormatter={(v: number) => formatRateCompact(v)}
                width={46}
              />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => formatRate(v)} />
              <Area
                type="monotone"
                dataKey="rx"
                name={t('widget.traffic.down')}
                stroke="var(--kr-accent)"
                fill="url(#rx)"
              />
              <Area
                type="monotone"
                dataKey="tx"
                name={t('widget.traffic.up')}
                stroke="var(--kr-success)"
                fill="url(#tx)"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
