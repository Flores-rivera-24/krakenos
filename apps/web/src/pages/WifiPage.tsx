import type { GuestNetwork, WifiNetwork } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { GuestNetworkCard } from '@/components/wifi/GuestNetworkCard';
import { MainNetworkCard } from '@/components/wifi/MainNetworkCard';
import { NetworksCard } from '@/components/wifi/NetworksCard';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

export function WifiPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [wifi, setWifi] = useState<WifiNetwork | null>(null);
  const [guest, setGuest] = useState<GuestNetwork | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([api.get<WifiNetwork>('/wifi'), api.get<GuestNetwork>('/wifi/guest')])
      .then(([w, g]) => {
        if (!active) return;
        setWifi(w);
        setGuest(g);
      })
      .catch(() => active && setError('No se pudo cargar la configuración WiFi'));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-6 p-6">
      <div>
        <h2 className="text-xl font-semibold">Red WiFi</h2>
        <p className="text-sm text-muted-foreground">
          {isAdmin
            ? 'Gestiona tu red principal y la de invitados.'
            : 'Solo lectura — se requiere rol admin para editar.'}
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {!wifi || !guest ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Cargando…</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <MainNetworkCard network={wifi} isAdmin={isAdmin} onUpdated={setWifi} />
          <GuestNetworkCard network={guest} isAdmin={isAdmin} onUpdated={setGuest} />
        </div>
      )}

      <NetworksCard />
    </div>
  );
}
