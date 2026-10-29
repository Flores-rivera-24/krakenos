import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingLine } from '@/components/ui/loading-line';
import { WidgetError } from '@/components/ui/widget-error';
import { formatUptime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useSystemStats } from '@/lib/resources';
import '@/lib/i18n/catalog/fragments/panel';

function Meter({ label, percent, detail }: { label: string; percent: number; detail: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-kr-sm">
        <span className="text-kr-secondary">{label}</span>
        <span className="text-kr-primary">{detail}</span>
      </div>
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-kr-elevated">
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
  // Comparte con la barra lateral una sola petición y sondea sin gastar con la pestaña oculta.
  // El fallo se distingue de «cargando»: si no, el widget gira para siempre sin avisar de que el agente no contesta.
  const { data: stats, error, refetch } = useSystemStats({ pollMs: 5000 });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>{t('widget.system.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && !stats ? (
          <WidgetError message={t('widget.system.error')} onRetry={() => void refetch()} />
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
              detail={t('widget.system.cpuDetail', {
                percent: stats.cpu.loadPercent,
                cores: stats.cpu.cores,
              })}
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
