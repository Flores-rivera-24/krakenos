import { ChevronDown, ChevronUp, Eye, EyeOff, Settings2 } from 'lucide-react';
import { useEffect, useState, type ComponentType } from 'react';
import { AlertsWidget } from '@/components/dashboard/widgets/AlertsWidget';
import { DeviceCountWidget } from '@/components/dashboard/widgets/DeviceCountWidget';
import { IotStatusWidget } from '@/components/dashboard/widgets/IotStatusWidget';
import { NetworkTopologyWidget } from '@/components/dashboard/widgets/NetworkTopologyWidget';
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
import { cn } from '@/lib/utils';
import { useInventoryStore } from '@/store/inventory.store';

const WIDGET_COMPONENTS: Record<WidgetId, ComponentType> = {
  topology: NetworkTopologyWidget,
  traffic: TrafficWidget,
  devices: DeviceCountWidget,
  iot: IotStatusWidget,
  system: SystemWidget,
  alerts: AlertsWidget,
  wifi: WifiStatusWidget,
};

const WIDGET_META = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));

export function DashboardPage() {
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
          <h2 className="text-kr-xl font-semibold text-kr-primary">Dashboard</h2>
          <p className="text-kr-sm text-kr-secondary">
            {connected ? 'En tiempo real · conectado' : 'Desconectado'}
          </p>
        </div>
        <Button
          variant={editing ? 'default' : 'outline'}
          size="sm"
          onClick={() => setEditing((v) => !v)}
        >
          <Settings2 className="h-4 w-4" />
          {editing ? 'Hecho' : 'Personalizar'}
        </Button>
      </div>

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
                      aria-label={`Subir ${meta.title}`}
                      onClick={() => update(moveWidget(layout, id, 'up'))}
                      className="rounded p-1 text-kr-secondary hover:bg-kr-surface hover:text-kr-primary"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`Bajar ${meta.title}`}
                      onClick={() => update(moveWidget(layout, id, 'down'))}
                      className="rounded p-1 text-kr-secondary hover:bg-kr-surface hover:text-kr-primary"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      aria-label={`${hidden ? 'Mostrar' : 'Ocultar'} ${meta.title}`}
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
