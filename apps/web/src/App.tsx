import { lazy, Suspense, useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { verifySession } from '@/lib/session';
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
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
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
  // Al recargar, valida la sesión persistida antes de renderizar las rutas.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (useAuthStore.getState().tokens) {
      void verifySession().finally(() => setReady(true));
    } else {
      setReady(true);
    }
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
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
