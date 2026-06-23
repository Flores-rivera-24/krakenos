import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { bootstrapSession } from '@/lib/session';
import { useAuthStore } from '@/store/auth.store';

// Lazy-load de páginas: cada una es su propio chunk. Aísla Recharts
// (Dashboard) del bundle inicial.
const LoginPage = lazy(() => import('@/pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const SetupPage = lazy(() => import('@/pages/SetupPage').then((m) => ({ default: m.SetupPage })));
const DashboardPage = lazy(() =>
  import('@/pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);
const InventoryPage = lazy(() =>
  import('@/pages/InventoryPage').then((m) => ({ default: m.InventoryPage })),
);
const WifiPage = lazy(() => import('@/pages/WifiPage').then((m) => ({ default: m.WifiPage })));
const VpnPage = lazy(() => import('@/pages/VpnPage').then((m) => ({ default: m.VpnPage })));
const TrafficPage = lazy(() =>
  import('@/pages/TrafficPage').then((m) => ({ default: m.TrafficPage })),
);
const IotPage = lazy(() => import('@/pages/IotPage').then((m) => ({ default: m.IotPage })));
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
const CompatibilityPage = lazy(() =>
  import('@/pages/CompatibilityPage').then((m) => ({ default: m.CompatibilityPage })),
);

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Cargando…</p>
    </div>
  );
}

/** Protege rutas: redirige a /login si no hay sesión. */
function RequireAuth() {
  const user = useAuthStore((s) => s.user);
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

export function App() {
  // Al cargar, intenta restaurar la sesión vía la cookie httpOnly del refresh
  // token (el access token no se persiste; solo vive en memoria, US-91).
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void bootstrapSession().finally(() => setReady(true));
  }, []);

  if (!ready) return <FullScreenLoader />;

  return (
    <Suspense fallback={<FullScreenLoader />}>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="inventory" element={<InventoryPage />} />
            <Route path="wifi" element={<WifiPage />} />
            <Route path="vpn" element={<VpnPage />} />
            <Route path="traffic" element={<TrafficPage />} />
            <Route path="iot" element={<IotPage />} />
            <Route path="cameras" element={<CamerasPage />} />
            <Route path="firewall" element={<FirewallPage />} />
            <Route path="vlans" element={<VlanPage />} />
            <Route path="qos" element={<QosPage />} />
            <Route path="dns" element={<DnsPage />} />
            <Route path="compatibility" element={<CompatibilityPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
