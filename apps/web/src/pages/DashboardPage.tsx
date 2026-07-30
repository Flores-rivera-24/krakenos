import { ChevronDown, ChevronUp, Eye, EyeOff, Settings2 } from 'lucide-react';
import { Suspense, lazy, useEffect, useMemo, useState, type ComponentType } from 'react';
import { GettingStarted } from '@/components/dashboard/GettingStarted';
import { AlertsWidget } from '@/components/dashboard/widgets/AlertsWidget';
import { CoverageWidget } from '@/components/dashboard/widgets/CoverageWidget';
import { DeviceCountWidget } from '@/components/dashboard/widgets/DeviceCountWidget';
import { AlarmWidget } from '@/components/dashboard/widgets/AlarmWidget';
import { HomeModeWidget } from '@/components/dashboard/widgets/HomeModeWidget';
import { IotStatusWidget } from '@/components/dashboard/widgets/IotStatusWidget';
import { QuickActionsWidget } from '@/components/dashboard/widgets/QuickActionsWidget';
import { ScenesWidget } from '@/components/dashboard/widgets/ScenesWidget';
import { SystemWidget } from '@/components/dashboard/widgets/SystemWidget';
import { WifiStatusWidget } from '@/components/dashboard/widgets/WifiStatusWidget';
import { Button } from '@/components/ui/button';
import { LoadingLine } from '@/components/ui/loading-line';
import {
  loadLayout,
  moveWidget,
  saveLayout,
  toggleHidden,
  WIDGETS,
  widgetsForUser,
  type DashboardLayout,
  type WidgetId,
} from '@/lib/dashboard';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { useInventoryStore } from '@/store/inventory.store';

/**
 * US-239 (AUD3-27): `TrafficWidget` importa **Recharts (98,7 kB gzip)** de forma
 * estática, así que se descargaba al abrir el dashboard **aunque el widget
 * estuviera oculto** — y ahora también cuando el rol ni siquiera lo ve. La
 * topología es un SVG grande con su propia lógica. Ambos pasan a `lazy()`: su
 * chunk se pide solo si el widget se va a pintar de verdad.
 */
const TrafficWidget = lazy(() =>
  import('@/components/dashboard/widgets/TrafficWidget').then((m) => ({ default: m.TrafficWidget })),
);
const NetworkTopologyWidget = lazy(() =>
  import('@/components/dashboard/widgets/NetworkTopologyWidget').then((m) => ({
    default: m.NetworkTopologyWidget,
  })),
);

const WIDGET_COMPONENTS: Record<WidgetId, ComponentType> = {
  quickActions: QuickActionsWidget,
  homeMode: HomeModeWidget,
  alarm: AlarmWidget,
  scenes: ScenesWidget,
  topology: NetworkTopologyWidget,
  traffic: TrafficWidget,
  devices: DeviceCountWidget,
  iot: IotStatusWidget,
  system: SystemWidget,
  alerts: AlertsWidget,
  wifi: WifiStatusWidget,
  coverage: CoverageWidget,
};

const WIDGET_META = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));

export function DashboardPage() {
  const t = useT();
  const connected = useInventoryStore((s) => s.connected);
  const subscribe = useInventoryStore((s) => s.subscribe);
  useEffect(() => subscribe(), [subscribe]);

  const [layout, setLayout] = useState(loadLayout);
  const [editing, setEditing] = useState(false);

  // US-239 (AUD3-28): el dashboard ignoraba rol y modo sencillo. El layout
  // guardado en localStorage sigue conservando TODOS los widgets —si el rol
  // cambia, reaparecen sin perder el orden—; aquí solo se filtra lo que se pinta.
  const role = useAuthStore((s) => s.user?.role);
  const uiMode = useAuthStore((s) => s.user?.uiMode);
  const permitidos = useMemo(
    () => new Set(widgetsForUser(role, uiMode).map((w) => w.id)),
    [role, uiMode],
  );

  const update = (next: DashboardLayout) => {
    setLayout(next);
    saveLayout(next);
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-kr-xl font-semibold text-kr-primary">{t('dashboard.title')}</h2>
          <p className="text-kr-sm text-kr-secondary">
            {connected ? t('dashboard.realtime') : t('dashboard.disconnected')}
          </p>
        </div>
        <Button
          variant={editing ? 'default' : 'outline'}
          size="sm"
          onClick={() => setEditing((v) => !v)}
        >
          <Settings2 className="h-4 w-4" />
          {editing ? t('dashboard.done') : t('dashboard.customize')}
        </Button>
      </div>

      <GettingStarted />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {layout.order.map((id) => {
          const meta = WIDGET_META[id];
          const Widget = WIDGET_COMPONENTS[id];
          const hidden = layout.hidden.includes(id);
          if (!meta || !permitidos.has(id) || (hidden && !editing)) return null;

          return (
            <div key={id} className={cn(meta.span === 2 && 'lg:col-span-2', hidden && 'opacity-50')}>
              {editing && (
                <div className="mb-1 flex items-center justify-between rounded-md bg-kr-elevated px-2 py-1">
                  <span className="text-kr-sm text-kr-secondary">{meta.title}</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={t('dashboard.moveUp', { title: meta.title })}
                      onClick={() => update(moveWidget(layout, id, 'up'))}
                      className="rounded p-1 text-kr-secondary hover:bg-kr-surface hover:text-kr-primary"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={t('dashboard.moveDown', { title: meta.title })}
                      onClick={() => update(moveWidget(layout, id, 'down'))}
                      className="rounded p-1 text-kr-secondary hover:bg-kr-surface hover:text-kr-primary"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={
                        hidden
                          ? t('dashboard.show', { title: meta.title })
                          : t('dashboard.hide', { title: meta.title })
                      }
                      onClick={() => update(toggleHidden(layout, id))}
                      className="rounded p-1 text-kr-secondary hover:bg-kr-surface hover:text-kr-primary"
                    >
                      {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )}
              <Suspense fallback={<LoadingLine />}>
                <Widget />
              </Suspense>
            </div>
          );
        })}
      </div>
    </div>
  );
}
