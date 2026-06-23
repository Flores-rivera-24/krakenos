import { MoreHorizontal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { LogoMark } from '@/components/ui/logo';
import { useSidebarStats } from '@/lib/sidebar-stats';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { useConnectionStore } from '@/store/connection.store';
import { AppSidebar } from './AppSidebar';
import { MOBILE_PRIMARY, MOBILE_SECONDARY, type NavItem } from './nav';

const COLLAPSE_KEY = 'krakenos-sidebar-collapsed';

function bottomLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'flex min-w-[4rem] flex-1 flex-col items-center gap-1 py-2 text-kr-xs',
    isActive ? 'text-kr-accent' : 'text-kr-secondary',
  );
}

function MobileBottomNav() {
  const [moreOpen, setMoreOpen] = useState(false);
  return (
    <>
      {/* Panel "Más" — resto de secciones */}
      {moreOpen && (
        <div className="fixed inset-0 z-20 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/30" />
          <div
            className="absolute inset-x-0 bottom-14 rounded-t-xl border-t border-kr bg-kr-elevated p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-kr-base font-semibold text-kr-primary">Más secciones</span>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => setMoreOpen(false)}
                className="text-kr-secondary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {MOBILE_SECONDARY.map(({ to, label, icon: Icon, end }: NavItem) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex flex-col items-center gap-1 rounded-lg p-3 text-kr-xs',
                      isActive
                        ? 'bg-kr-surface text-kr-accent'
                        : 'text-kr-secondary hover:bg-kr-surface',
                    )
                  }
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-kr bg-kr-surface md:hidden">
        {MOBILE_PRIMARY.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={bottomLinkClass}>
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-label="Más"
          className={cn(
            'flex min-w-[4rem] flex-1 flex-col items-center gap-1 py-2 text-kr-xs',
            moreOpen ? 'text-kr-accent' : 'text-kr-secondary',
          )}
        >
          <MoreHorizontal className="h-5 w-5" />
          Más
        </button>
      </nav>
    </>
  );
}

export function AppLayout() {
  const logout = useAuthStore((s) => s.logout);
  const stats = useSidebarStats();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');

  // Refleja el estado real del stream Socket.io en el indicador de conexión (US-94).
  useEffect(() => useConnectionStore.getState().subscribe(), []);

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  return (
    <div className="flex min-h-screen bg-kr-base text-kr-primary">
      <AppSidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} stats={stats} />

      {/* Columna principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — solo móvil */}
        <header className="flex items-center justify-between border-b border-kr bg-kr-surface px-4 py-3 md:hidden">
          <span className="flex items-center gap-2">
            <LogoMark className="h-6 w-6 text-kr-accent" />
            <span className="text-kr-lg font-semibold text-kr-primary">KrakenOS</span>
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            aria-label="Salir"
            className="text-kr-sm text-kr-secondary hover:text-kr-primary"
          >
            Salir
          </button>
        </header>

        <main className="flex-1 pb-20 md:pb-0">
          <Outlet />
        </main>

        <MobileBottomNav />
      </div>
    </div>
  );
}
