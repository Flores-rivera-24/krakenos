import type { WifiNetworkInfo } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { StatusDot } from '@/components/ui/status-dot';
import { api } from '@/lib/api';

/** SSIDs activos y clientes conectados por red. */
export function WifiStatusWidget() {
  const [networks, setNetworks] = useState<WifiNetworkInfo[] | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<WifiNetworkInfo[]>('/wifi/networks')
      .then((n) => active && setNetworks(n))
      .catch(() => active && setNetworks([]));
    return () => {
      active = false;
    };
  }, []);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle>WiFi</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {networks === null ? (
          <p className="py-4 text-center text-kr-sm text-kr-muted">Cargando…</p>
        ) : networks.length === 0 ? (
          <p className="py-4 text-center text-kr-sm text-kr-muted">Sin redes WiFi.</p>
        ) : (
          <>
            {networks.map((n) => (
              <div key={n.id} className="flex items-center justify-between text-kr-base">
                <span className="flex min-w-0 items-center gap-2">
                  <StatusDot status={n.enabled ? 'online' : 'offline'} />
                  <span className="truncate text-kr-primary">{n.ssid || '(oculta)'}</span>
                  {n.isGuest && <span className="text-kr-xs text-kr-muted">invitados</span>}
                </span>
                <span className="shrink-0 text-kr-secondary">{n.clientCount} clientes</span>
              </div>
            ))}
            <Link to="/wifi" className="inline-block text-kr-sm text-kr-link hover:underline">
              Gestionar WiFi →
            </Link>
          </>
        )}
      </CardContent>
    </Card>
  );
}
