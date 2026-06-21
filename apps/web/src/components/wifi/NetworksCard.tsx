import type { AccessPoint, WifiClient, WifiNetworkInfo } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function NetworksCard() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [aps, setAps] = useState<AccessPoint[]>([]);
  const [networks, setNetworks] = useState<WifiNetworkInfo[]>([]);
  const [clientsOf, setClientsOf] = useState<{ net: WifiNetworkInfo; clients: WifiClient[] } | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.get<AccessPoint[]>('/wifi/access-points'),
      api.get<WifiNetworkInfo[]>('/wifi/networks'),
    ])
      .then(([a, n]) => {
        if (!active) return;
        setAps(a);
        setNetworks(n);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const apName = (id: string) => aps.find((a) => a.id === id)?.name ?? id;

  const toggle = async (net: WifiNetworkInfo) => {
    const updated = await api.put<WifiNetworkInfo>(`/wifi/networks/${net.id}`, {
      enabled: !net.enabled,
    });
    setNetworks((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
  };

  const showClients = async (net: WifiNetworkInfo) => {
    const clients = await api.get<WifiClient[]>(`/wifi/networks/${net.id}/clients`);
    setClientsOf({ net, clients });
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base text-foreground">Puntos de acceso y redes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {aps.map((ap) => (
            <span
              key={ap.id}
              className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
            >
              {ap.name} · {ap.ip}{' '}
              <span className={ap.online ? 'text-green-500' : 'text-destructive'}>
                {ap.online ? '●' : '○'}
              </span>
            </span>
          ))}
        </div>

        <div className="overflow-hidden rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-secondary-foreground">
              <tr>
                <th className="px-3 py-2 text-left">SSID</th>
                <th className="px-3 py-2 text-left">Banda</th>
                <th className="px-3 py-2 text-left">AP</th>
                <th className="px-3 py-2 text-left">Clientes</th>
                <th className="px-3 py-2 text-right">Activa</th>
              </tr>
            </thead>
            <tbody>
              {networks.map((n) => (
                <tr key={n.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    {n.ssid}
                    {n.isGuest && <span className="ml-1 text-xs text-muted-foreground">(invitados)</span>}
                  </td>
                  <td className="px-3 py-2">{n.band}</td>
                  <td className="px-3 py-2 text-muted-foreground">{apName(n.apId)}</td>
                  <td className="px-3 py-2">
                    <button
                      className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                      onClick={() => void showClients(n)}
                      disabled={n.clientCount === 0}
                    >
                      {n.clientCount}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end">
                      <Switch checked={n.enabled} onCheckedChange={() => void toggle(n)} disabled={!isAdmin} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>

      {clientsOf && (
        <Dialog open onClose={() => setClientsOf(null)} aria-labelledby="dialog-clients-title">
          <div className="mb-3 flex items-start justify-between">
            <h3 id="dialog-clients-title" className="text-lg font-semibold">
              Clientes · {clientsOf.net.ssid}
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setClientsOf(null)}>
              Cerrar
            </Button>
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">Dispositivo</th>
                <th className="py-1">IP</th>
                <th className="py-1">Señal</th>
              </tr>
            </thead>
            <tbody>
              {clientsOf.clients.map((c) => (
                <tr key={c.mac} className="border-t border-border">
                  <td className="py-1">{c.hostname ?? c.mac}</td>
                  <td className="py-1 font-mono text-xs">{c.ip}</td>
                  <td className="py-1">{c.signalDbm} dBm</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Dialog>
      )}
    </Card>
  );
}
