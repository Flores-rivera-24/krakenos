import { MoreHorizontal, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { LogoMark } from '@/components/ui/logo';
import { Toaster } from '@/components/ui/toast';
import { useT } from '@/lib/i18n';
import { useSidebarStats } from '@/lib/sidebar-stats';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { useConnectionStore } from '@/store/connection.store';
import { AppSidebar } from './AppSidebar';
import { mobileNavForRole, type NavItem } from './nav';

const COLLAPSE_KEY = 'krakenos-sidebar-collapsed';

// Reparto equitativo: `min-w-0 flex-1 basis-0` deja que las 6 celdas encojan por
// igual a ≤375px (en vez de `min-w-[4rem]`, que sumaba 384px y desbordaba), y la
// etiqueta trunca para no solaparse con la vecina (US-97).
const BOTTOM_ITEM_BASE =
  'flex min-w-0 flex-1 basis-0 flex-col items-center gap-0.5 px-0.5 py-2';

function bottomLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(BOTTOM_ITEM_BASE, isActive ? 'text-kr-link' : 'text-kr-secondary');
}

function MobileBottomNav() {
  const t = useT();
  const [moreOpen, setMoreOpen] = useState(false);
  // Bottom-nav filtrada por rol (US-179) y modo sencillo (US-176).
  const role = useAuthStore((s) => s.user?.role);
  const uiMode = useAuthStore((s) => s.user?.uiMode);
  const { primary, secondary } = mobileNavForRole(role, uiMode);
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
              <span className="text-kr-base font-semibold text-kr-primary">{t('layout.moreSections')}</span>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setMoreOpen(false)}
                className="text-kr-secondary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {secondary.map(({ to, labelKey, icon: Icon, end }: NavItem) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={() => setMoreOpen(false)}
                  className={({ isActive }) =>
                    cn(
                      'flex flex-col items-center gap-1 rounded-lg p-3 text-kr-xs',
                      isActive
                        ? 'bg-kr-surface text-kr-link'
                        : 'text-kr-secondary hover:bg-kr-surface',
                    )
                  }
                >
                  <Icon className="h-5 w-5" />
                  {t(labelKey)}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* `pb-[env(safe-area-inset-bottom)]` (US-234): en iPhone con la app
          instalada, sin esto las celdas quedan BAJO el home indicator y la
          última fila de iconos es intocable. */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-kr bg-kr-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {primary.map(({ to, labelKey, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={bottomLinkClass}>
            <Icon className="h-5 w-5 shrink-0" />
            <span className="w-full truncate text-center text-[10px] leading-tight">{t(labelKey)}</span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-label={t('layout.more')}
          className={cn(BOTTOM_ITEM_BASE, moreOpen ? 'text-kr-link' : 'text-kr-secondary')}
        >
          <MoreHorizontal className="h-5 w-5 shrink-0" />
          <span className="w-full truncate text-center text-[10px] leading-tight">{t('layout.more')}</span>
        </button>
      </nav>
    </>
  );
}

export function AppLayout() {
  const t = useT();
  const logout = useAuthStore((s) => s.logout);
  const stats = useSidebarStats();
  const location = useLocation();
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
        <header className="flex items-center justify-between border-b border-kr bg-kr-surface px-4 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] md:hidden">
          <span className="flex items-center gap-2">
            <LogoMark className="h-6 w-6 text-kr-accent" />
            <span className="text-kr-lg font-semibold text-kr-primary">KrakenOS</span>
          </span>
          <button
            type="button"
            onClick={() => void logout()}
            aria-label={t('common.logout')}
            className="text-kr-sm text-kr-secondary hover:text-kr-primary"
          >
            {t('common.logout')}
          </button>
        </header>

        {/* La `key` por ruta reinicia el fade en cada navegación (transición sutil,
            US-160). motion-reduce desactiva el desplazamiento. */}
        <main key={location.pathname} className="flex-1 animate-kr-fade-up pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0">
          <Outlet />
        </main>

        <MobileBottomNav />
      </div>

      <Toaster />
    </div>
  );
}
