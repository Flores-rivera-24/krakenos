import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { WidgetError } from '@/components/ui/widget-error';
import { formatUptime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useSystemStats } from '@/lib/resources';

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
  /**
   * US-262: dos arreglos en el mismo sitio.
   *
   *  - `/system/stats` la pedía **también** la barra lateral, así que abrir el
   *    dashboard la pedía dos veces en el mismo tick.
   *  - El sondeo era un `setInterval` a pelo, no `usePolling`: seguía preguntando
   *    cada 5 s con la pestaña **oculta**, que es exactamente el gasto que US-239
   *    (AUD3-27) fue a quitar y que este widget se saltaba.
   *
   * US-234 sigue vigente: el fallo se distingue de «cargando», o el widget gira
   * para siempre y nadie sabe que el agente no contesta.
   */
  const { data: stats, error, refetch } = useSystemStats({ pollMs: 5000 });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t('widget.system.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && !stats ? (
          <WidgetError what="el estado del sistema" onRetry={() => void refetch()} />
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
