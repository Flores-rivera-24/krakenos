import type { SystemStats } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatUptime } from '@/lib/format';

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
  const [stats, setStats] = useState<SystemStats | null>(null);

  useEffect(() => {
    let active = true;
    const load = () =>
      api
        .get<SystemStats>('/system/stats')
        .then((s) => active && setStats(s))
        .catch(() => undefined);
    void load();
    const id = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>Sistema</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!stats ? (
          <p className="py-6 text-center text-kr-sm text-kr-muted">Cargando…</p>
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
