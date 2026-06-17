import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { DashboardPage } from '@/pages/DashboardPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { LoginPage } from '@/pages/LoginPage';
import { PlaceholderPage } from '@/pages/PlaceholderPage';
import { useAuthStore } from '@/store/auth.store';

/** Protege rutas: redirige a /login si no hay sesión. */
function RequireAuth() {
  const user = useAuthStore((s) => s.user);
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route
            path="wifi"
            element={
              <PlaceholderPage
                title="Red WiFi"
                description="Gestión de SSID, contraseña y red de invitados. Próximamente."
              />
            }
          />
          <Route
            path="settings"
            element={
              <PlaceholderPage
                title="Ajustes"
                description="Configuración del sistema y del hogar. Próximamente."
              />
            }
          />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
