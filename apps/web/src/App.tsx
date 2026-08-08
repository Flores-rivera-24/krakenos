import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Splash } from '@/components/ui/splash';
import { changeLocale, useT } from '@/lib/i18n';
import { bootstrapSession } from '@/lib/session';
import { useAuthStore } from '@/store/auth.store';

// Lazy-load de páginas: cada una es su propio chunk. Aísla Recharts
// (Dashboard) del bundle inicial.
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const SetupPage = lazy(() => import('@/pages/SetupPage').then((m) => ({ default: m.SetupPage })));
const WelcomePage = lazy(() =>
  import('@/pages/WelcomePage').then((m) => ({ default: m.WelcomePage })),
);
const InvitePage = lazy(() => import('@/pages/InvitePage').then((m) => ({ default: m.InvitePage })));
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const ConnectPage = lazy(() =>
  import('@/pages/ConnectPage').then((m) => ({ default: m.ConnectPage })),
);
const InventoryPage = lazy(() =>
  import('@/pages/InventoryPage').then((m) => ({ default: m.InventoryPage })),
);
const WifiPage = lazy(() => import('@/pages/WifiPage').then((m) => ({ default: m.WifiPage })));
const CoveragePage = lazy(() =>
  import('@/pages/CoveragePage').then((m) => ({ default: m.CoveragePage })),
);
const VpnPage = lazy(() => import('@/pages/VpnPage').then((m) => ({ default: m.VpnPage })));
const TrafficPage = lazy(() =>
  import('@/pages/TrafficPage').then((m) => ({ default: m.TrafficPage })),
);
const IotPage = lazy(() => import('@/pages/IotPage').then((m) => ({ default: m.IotPage })));
const EnergyPage = lazy(() => import('@/pages/EnergyPage').then((m) => ({ default: m.EnergyPage })));
const PeoplePage = lazy(() =>
  import('@/pages/PeoplePage').then((m) => ({ default: m.PeoplePage })),
);
const RoomsPage = lazy(() => import('@/pages/RoomsPage').then((m) => ({ default: m.RoomsPage })));
const ScenesPage = lazy(() => import('@/pages/ScenesPage').then((m) => ({ default: m.ScenesPage })));
const AutomationsPage = lazy(() =>
  import('@/pages/AutomationsPage').then((m) => ({ default: m.AutomationsPage })),
);
const CamerasPage = lazy(() =>
  import('@/pages/CamerasPage').then((m) => ({ default: m.CamerasPage })),
);
const FirewallPage = lazy(() =>
  import('@/pages/FirewallPage').then((m) => ({ default: m.FirewallPage })),
);
const VlanPage = lazy(() => import('@/pages/VlanPage').then((m) => ({ default: m.VlanPage })));
const QosPage = lazy(() => import('@/pages/QosPage').then((m) => ({ default: m.QosPage })));
const DnsPage = lazy(() => import('@/pages/DnsPage').then((m) => ({ default: m.DnsPage })));
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

/**
 * Protege rutas. Sin sesión manda al login **salvo en la raíz**, donde manda a la
 * portada (US-266).
 *
 * La distinción importa: quien escribe la dirección a secas no ha pedido nada
 * concreto y la portada le dice qué es esto y en qué estado está la instalación.
 * Quien venía a `/iot` sí ha pedido algo, y mandarlo a una portada en vez de al
 * formulario le añade un clic y le esconde lo que quería. La portada no es un
 * peaje: en cuanto hay sesión (la cookie del refresh la restaura al arrancar), la
 * raíz vuelve a ser el dashboard sin pasar por ella.
 */
function RequireAuth() {
  const user = useAuthStore((s) => s.user);
  const { pathname } = useLocation();
  if (user) return <Outlet />;
  return <Navigate to={pathname === '/' ? '/bienvenida' : '/login'} replace />;
}

export function App() {
  // Al cargar, intenta restaurar la sesión vía la cookie httpOnly del refresh
  // token (el access token no se persiste; solo vive en memoria, US-91).
  const [ready, setReady] = useState(false);
  const t = useT();
  const userLocale = useAuthStore((s) => s.user?.locale);
  useEffect(() => {
    void bootstrapSession().finally(() => setReady(true));
  }, []);

  // La preferencia de idioma del usuario (servidor) prima sobre la del
  // dispositivo (US-177): al iniciar/restaurar sesión, aplica y persiste su
  // idioma. Sin sesión, se mantiene el resuelto en el arranque.
  useEffect(() => {
    // `changeLocale` y no `setLocale`: el catálogo del idioma del usuario puede
    // no estar cargado todavía (US-262), y activarlo antes dejaría la primera
    // pantalla tras el login en español.
    if (userLocale) void changeLocale(userLocale);
  }, [userLocale]);

  if (!ready) return <Splash label={t('app.booting')} />;

  return (
    <Suspense fallback={<Splash />}>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/bienvenida" element={<WelcomePage />} />
        {/* Pública: quien abre una invitación todavía no tiene cuenta (US-267). */}
        <Route path="/invitacion/:token" element={<InvitePage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="connect" element={<ConnectPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="wifi" element={<WifiPage />} />
            <Route path="coverage" element={<CoveragePage />} />
            <Route path="vpn" element={<VpnPage />} />
            <Route path="traffic" element={<TrafficPage />} />
            <Route path="people" element={<PeoplePage />} />
            <Route path="rooms" element={<RoomsPage />} />
            <Route path="scenes" element={<ScenesPage />} />
            <Route path="automations" element={<AutomationsPage />} />
            <Route path="iot" element={<IotPage />} />
            <Route path="energy" element={<EnergyPage />} />
            <Route path="cameras" element={<CamerasPage />} />
            <Route path="firewall" element={<FirewallPage />} />
            <Route path="vlans" element={<VlanPage />} />
            <Route path="qos" element={<QosPage />} />
            <Route path="dns" element={<DnsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
