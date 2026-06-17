import { Activity } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ActivityEvent } from '@/store/inventory.store';
import { timeAgo } from '@/lib/format';

interface RecentActivityCardProps {
  events: ActivityEvent[];
}

const KIND_LABEL: Record<ActivityEvent['kind'], string> = {
  updated: 'actualizado',
  removed: 'eliminado',
};

/** Feed de las últimas acciones sobre el inventario (en tiempo real). */
export function RecentActivityCard({ events }: RecentActivityCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>Actividad reciente</CardTitle>
        <Activity className="h-4 w-4 text-primary" />
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Sin actividad todavía. Lanza un re-escaneo.
          </p>
        ) : (
          <ul className="space-y-2 text-sm">
            {events.slice(0, 6).map((e) => (
              <li key={e.id} className="flex items-center justify-between">
                <span className="truncate">
                  <span
                    className={
                      e.kind === 'removed' ? 'text-muted-foreground' : 'text-foreground'
                    }
                  >
                    {e.label}
                  </span>{' '}
                  <span className="text-xs text-muted-foreground">{KIND_LABEL[e.kind]}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(e.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
