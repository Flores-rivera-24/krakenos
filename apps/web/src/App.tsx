import { useEffect, useState } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { verifySession } from '@/lib/session';
import { DashboardPage } from '@/pages/DashboardPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { LoginPage } from '@/pages/LoginPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SetupPage } from '@/pages/SetupPage';
import { WifiPage } from '@/pages/WifiPage';
import { useAuthStore } from '@/store/auth.store';

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

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Cargando…</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="wifi" element={<WifiPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
