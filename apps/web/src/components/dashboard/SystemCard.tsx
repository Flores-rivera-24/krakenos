import type { SystemStats } from '@krakenos/types';
import { Cpu, HardDrive, Server } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { formatBytes, formatUptime } from '@/lib/format';

/** Barra de progreso simple para porcentajes. */
function Meter({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{detail}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${Math.min(100, percent)}%` }}
        />
      </div>
    </div>
  );
}

export function SystemCard() {
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
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>Sistema</CardTitle>
        <Server className="h-4 w-4 text-primary" />
      </CardHeader>
      <CardContent className="space-y-3">
        {!stats ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
        ) : (
          <>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Uptime</span>
              <span className="font-medium">{formatUptime(stats.uptimeSeconds)}</span>
            </div>
            <Meter
              label="CPU"
              percent={stats.cpu.loadPercent}
              detail={`${stats.cpu.loadPercent}% · ${stats.cpu.cores} núcleos`}
            />
            <Meter
              label="Memoria"
              percent={stats.memory.usedPercent}
              detail={`${formatBytes(stats.memory.usedBytes)} / ${formatBytes(stats.memory.totalBytes)}`}
            />
            <div className="flex gap-4 pt-1 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Cpu className="h-3 w-3" /> {stats.cpu.cores} cores
              </span>
              <span className="flex items-center gap-1">
                <HardDrive className="h-3 w-3" /> {stats.memory.usedPercent}% RAM
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
