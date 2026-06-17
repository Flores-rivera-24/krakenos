import { Navigate, Outlet, Route, Routes, Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { InventoryPage } from '@/pages/InventoryPage';
import { LoginPage } from '@/pages/LoginPage';
import { useAuthStore } from '@/store/auth.store';

/** Protege rutas: redirige a /login si no hay sesión. */
function RequireAuth() {
  const user = useAuthStore((s) => s.user);
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

function Layout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <Link to="/" className="text-lg font-semibold text-primary">
          KrakenOS
        </Link>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">{user?.displayName}</span>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            Salir
          </Button>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<InventoryPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
