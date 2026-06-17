import type { Device } from '@krakenos/types';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface AlertsCardProps {
  devices: Device[];
}

/** Alertas: dispositivos desconocidos detectados en la red. */
export function AlertsCard({ devices }: AlertsCardProps) {
  const unknown = devices.filter((d) => d.type === 'unknown' && d.online);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>Alertas</CardTitle>
        {unknown.length > 0 ? (
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        ) : (
          <ShieldCheck className="h-4 w-4 text-green-500" />
        )}
      </CardHeader>
      <CardContent>
        {unknown.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Sin dispositivos desconocidos.
          </p>
        ) : (
          <>
            <p className="mb-2 text-sm">
              <span className="font-bold text-amber-500">{unknown.length}</span> dispositivo
              {unknown.length > 1 ? 's' : ''} desconocido{unknown.length > 1 ? 's' : ''} en la red
            </p>
            <ul className="space-y-1 text-xs">
              {unknown.slice(0, 4).map((d) => (
                <li key={d.id} className="flex justify-between text-muted-foreground">
                  <span className="font-mono">{d.ip}</span>
                  <span className="font-mono">{d.mac}</span>
                </li>
              ))}
            </ul>
            <Link
              to="/inventory"
              className="mt-3 inline-block text-xs text-primary hover:underline"
            >
              Ver inventario →
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
