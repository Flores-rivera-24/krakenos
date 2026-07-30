import type { SystemStats } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { WidgetError } from '@/components/ui/widget-error';
import { api } from '@/lib/api';
import { formatUptime } from '@/lib/format';
import { useT } from '@/lib/i18n';

function Meter({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-kr-sm">
        <span className="text-kr-secondary">{label}</span>
        <span className="text-kr-primary">{detail}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-kr-elevated">
        <div
          className="h-full rounded-full bg-kr-accent transition-all"
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  );
}

/** Estado del servidor: uptime, CPU%, RAM%. */
export function SystemWidget() {
  const t = useT();
  const [stats, setStats] = useState<SystemStats | null>(null);
  // US-234: sin esto, un `.catch(() => undefined)` dejaba `stats` en null y el
  // widget giraba para siempre — indistinguible de «todavía cargando».
  const [failed, setFailed] = useState(false);
  const [intento, setIntento] = useState(0);

  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .get<SystemStats>('/system/stats')
        .then((s) => {
          if (!active) return;
          setStats(s);
          setFailed(false);
        })
        .catch(() => active && setFailed(true));
    void load();
    const id = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [intento]);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t('widget.system.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {failed && !stats ? (
          <WidgetError what="el estado del sistema" onRetry={() => setIntento((n) => n + 1)} />
        ) : !stats ? (
          <LoadingLine />
        ) : (
          <>
            <div className="flex items-center justify-between text-kr-sm">
              <span className="text-kr-secondary">Uptime</span>
              <span className="text-kr-primary">{formatUptime(stats.uptimeSeconds)}</span>
            </div>
            <Meter
              label="CPU"
              percent={stats.cpu.loadPercent}
              detail={`${stats.cpu.loadPercent}% · ${stats.cpu.cores} núcleos`}
            />
            <Meter
              label="RAM"
              percent={stats.memory.usedPercent}
              detail={`${stats.memory.usedPercent}%`}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}
