import type { GuestNetwork, WifiNetwork } from '@krakenos/types';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { GuestNetworkCard } from '@/components/wifi/GuestNetworkCard';
import { MainNetworkCard } from '@/components/wifi/MainNetworkCard';
import { NetworksCard } from '@/components/wifi/NetworksCard';
import { buttonVariants } from '@/components/ui/button';
import { ErrorBanner } from '@/components/ui/error-banner';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { describeError } from '@/lib/errors';
import { useAuthStore } from '@/store/auth.store';

export function WifiPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [wifi, setWifi] = useState<WifiNetwork | null>(null);
  const [guest, setGuest] = useState<GuestNetwork | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([api.get<WifiNetwork>('/wifi'), api.get<GuestNetwork>('/wifi/guest')])
      .then(([w, g]) => {
        if (!active) return;
        setWifi(w);
        setGuest(g);
      })
      .catch(
        (err) => active && setError(describeError(err, 'No se pudo cargar la configuración WiFi')),
      )
      .finally(() => active && setLoading(false));
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

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : wifi && guest ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <MainNetworkCard network={wifi} isAdmin={isAdmin} onUpdated={setWifi} />
          <GuestNetworkCard network={guest} isAdmin={isAdmin} onUpdated={setGuest} />
        </div>
      ) : (
        !error && (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-kr bg-kr-surface py-16 text-center">
            <p className="text-kr-secondary">Aún no hay configuración WiFi disponible.</p>
            <p className="mx-auto max-w-md text-kr-sm text-kr-muted">
              La configuración WiFi aparece cuando tu router está conectado a KrakenOS. Conéctalo para
              gestionar desde aquí el nombre de tu red, la contraseña y la red de invitados.
            </p>
            <Link to="/connect" className={buttonVariants()}>
              Conecta tu router
            </Link>
          </div>
        )
      )}

      <NetworksCard />
    </div>
  );
}
