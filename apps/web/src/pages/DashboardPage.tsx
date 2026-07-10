import { ChevronDown, ChevronUp, Eye, EyeOff, Settings2 } from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { GettingStarted } from '@/components/dashboard/GettingStarted';
import { AlertsWidget } from '@/components/dashboard/widgets/AlertsWidget';
import { CoverageWidget } from '@/components/dashboard/widgets/CoverageWidget';
import { DeviceCountWidget } from '@/components/dashboard/widgets/DeviceCountWidget';
import { HomeModeWidget } from '@/components/dashboard/widgets/HomeModeWidget';
import { IotStatusWidget } from '@/components/dashboard/widgets/IotStatusWidget';
import { NetworkTopologyWidget } from '@/components/dashboard/widgets/NetworkTopologyWidget';
import { QuickActionsWidget } from '@/components/dashboard/widgets/QuickActionsWidget';
import { ScenesWidget } from '@/components/dashboard/widgets/ScenesWidget';
import { SystemWidget } from '@/components/dashboard/widgets/SystemWidget';
import { TrafficWidget } from '@/components/dashboard/widgets/TrafficWidget';
import { WifiStatusWidget } from '@/components/dashboard/widgets/WifiStatusWidget';
import { Button } from '@/components/ui/button';
import {
  loadLayout,
  moveWidget,
  saveLayout,
  toggleHidden,
  WIDGETS,
  type DashboardLayout,
  type WidgetId,
} from '@/lib/dashboard';
import { useT } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useInventoryStore } from '@/store/inventory.store';

const WIDGET_COMPONENTS: Record<WidgetId, ComponentType> = {
  quickActions: QuickActionsWidget,
  homeMode: HomeModeWidget,
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
          if (!meta || (hidden && !editing)) return null;

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
              <Widget />
            </div>
          );
        })}
      </div>
    </div>
  );
}
