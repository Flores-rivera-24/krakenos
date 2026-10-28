import type { AccessPoint, WifiClient, WifiNetworkInfo } from '@krakenos/types';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useT } from '@/lib/i18n';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { OptimisticSwitch } from '@/components/ui/optimistic-switch';
import { StaleBadge } from '@/components/ui/stale-badge';
import { WidgetError } from '@/components/ui/widget-error';
import { api } from '@/lib/api';
import { useLectura } from '@/lib/use-lectura';
import { useAuthStore } from '@/store/auth.store';
import { useInventoryStore } from '@/store/inventory.store';
import '@/lib/i18n/catalog/fragments/inventario';
import '@/lib/i18n/catalog/fragments/wifi';

export function NetworksCard() {
  const t = useT();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  // Apodos del inventario por MAC (US-178): la lista de clientes usa el nombre
  // amable que la persona ya puso, no el hostname críptico.
  const devices = useInventoryStore((s) => s.devices);
  const inventoryLabels = useMemo(
    () =>
      new Map(
        Object.values(devices)
          .filter((d) => d.label)
          .map((d) => [d.mac.toLowerCase(), d.label as string]),
      ),
    [devices],
  );
  const lectura = useLectura(async () => {
    const [a, n] = await Promise.all([
      api.getList<AccessPoint>('/wifi/access-points'),
      api.getList<WifiNetworkInfo>('/wifi/networks'),
    ]);
    return { aps: a, networks: n };
  }, []);
  const aps = lectura.data?.aps ?? [];
  const networks = lectura.data?.networks ?? [];
  const [clientsOf, setClientsOf] = useState<{
    net: WifiNetworkInfo;
    clients: WifiClient[];
  } | null>(null);

  const apName = (id: string) => aps.find((a) => a.id === id)?.name ?? id;

  const toggle = async (net: WifiNetworkInfo, next: boolean) => {
    const updated = await api.put<WifiNetworkInfo>(`/wifi/networks/${net.id}`, { enabled: next });
    lectura.setData((prev) => ({
      aps: prev?.aps ?? [],
      networks: (prev?.networks ?? []).map((n) => (n.id === updated.id ? updated : n)),
    }));
  };

  const showClients = async (net: WifiNetworkInfo) => {
    const clients = await api.getList<WifiClient>(`/wifi/networks/${net.id}/clients`);
    setClientsOf({ net, clients });
  };

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base text-foreground">{t('wifi.networks.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {lectura.data === null && lectura.failed ? (
          <WidgetError message={t('wifi.networks.loadError')} onRetry={lectura.reintentar} />
        ) : (
          <>
            {lectura.failed && <StaleBadge />}
            <div className="flex flex-wrap gap-2">
              {aps.map((ap) => (
                <span
                  key={ap.id}
                  className="rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
                >
                  {ap.name} · {ap.ip}{' '}
                  <span className={ap.online ? 'text-success' : 'text-danger'}>
                    {ap.online ? '●' : '○'}
                  </span>
                </span>
              ))}
            </div>

            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-secondary-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">SSID</th>
                    <th className="px-3 py-2 text-left">{t('wifi.networks.band')}</th>
                    <th className="px-3 py-2 text-left">AP</th>
                    <th className="px-3 py-2 text-left">{t('wifi.networks.clients')}</th>
                    <th className="px-3 py-2 text-right">{t('wifi.networks.active')}</th>
                  </tr>
                </thead>
                <tbody>
                  {networks.map((n) => (
                    <tr key={n.id} className="border-t border-border">
                      <td className="px-3 py-2">
                        {n.ssid}
                        {n.isGuest && (
                          <span className="ml-1 text-xs text-muted-foreground">
                            {t('wifi.networks.guestTag')}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2">{n.band}</td>
                      <td className="px-3 py-2 text-muted-foreground">{apName(n.apId)}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          aria-label={t('wifi.networks.clientsButton', {
                            ssid: n.ssid,
                            n: n.clientCount,
                          })}
                          className="text-kr-link hover:underline disabled:text-muted-foreground disabled:no-underline"
                          onClick={() => void showClients(n)}
                          disabled={n.clientCount === 0}
                        >
                          {n.clientCount}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex justify-end">
                          <OptimisticSwitch
                            checked={n.enabled}
                            onToggle={(next) => toggle(n, next)}
                            disabled={!isAdmin}
                            errorMessage={t('wifi.networks.toggleError', { ssid: n.ssid })}
                            aria-label={t('wifi.networks.toggleLabel', { ssid: n.ssid })}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </CardContent>

      {clientsOf && (
        <Dialog open onClose={() => setClientsOf(null)} aria-labelledby="dialog-clients-title">
          <div className="mb-3 flex items-start justify-between">
            <h3 id="dialog-clients-title" className="text-lg font-semibold">
              {t('wifi.networks.clientsOf', { ssid: clientsOf.net.ssid })}
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setClientsOf(null)}>
              {t('common.close')}
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1">{t('inventory.col.device')}</th>
                  <th className="py-1">IP</th>
                  <th className="py-1">{t('wifi.networks.signal')}</th>
                </tr>
              </thead>
              <tbody>
                {clientsOf.clients.map((c) => {
                  // Apodo del inventario primero (US-178): "Móvil de Ana", no la MAC.
                  const nombre = inventoryLabels.get(c.mac.toLowerCase()) ?? c.hostname ?? c.mac;
                  return (
                    <tr key={c.mac} className="border-t border-border">
                      {/* El recorte es solo del celular: en escritorio la celda no cambia. */}
                      <td className="py-1 max-md:max-w-40 max-md:truncate" title={nombre}>
                        {nombre}
                      </td>
                      <td className="py-1 font-mono text-xs">{c.ip}</td>
                      <td className="py-1">{c.signalDbm} dBm</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Dialog>
      )}
    </Card>
  );
}
