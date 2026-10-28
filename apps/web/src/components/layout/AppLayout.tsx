import { MoreHorizontal, X } from 'lucide-react';
import { Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { LoadingLine } from '@/components/ui/loading-line';
import { Skeleton } from '@/components/ui/skeleton';
import { LogoMark } from '@/components/ui/logo';
import { Toaster } from '@/components/ui/toast';
import { useEstadosListos, useSincronizarEstados } from '@/lib/integration-states';
import { useT } from '@/lib/i18n';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { useRouteAnnounce } from '@/lib/use-route-announce';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { useInventoryStore } from '@/store/inventory.store';
import { useConnectionStore } from '@/store/connection.store';
import { AppSidebar } from './AppSidebar';
import { mobileNavForRole, type NavItem } from './nav';

/**
 * Lo que ocupa el `main` mientras la página no está lista (su chunk `lazy()` o el estado de los
 * dominios). Lleva el esqueleto (`kr-shimmer`) además del indicador: sin él, `main` está
 * «visible y quieto» antes de tener contenido y cualquier observador que espere a que la página
 * esté PINTADA (el e2e de accesibilidad mide el contraste) la da por lista y analiza una página
 * que aparece justo después, a medio animar.
 */
function CargandoPagina() {
  return (
    <div className="space-y-4 p-6">
      <LoadingLine />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

const COLLAPSE_KEY = 'krakenos-sidebar-collapsed';

// Reparto equitativo: `min-w-0 flex-1 basis-0` deja que las 5 celdas (4 destinos y «Más») encojan por
// igual a ≤375px (en vez de `min-w-[4rem]`, que sumaba 384px y desbordaba), y la
// etiqueta trunca para no solaparse con la vecina (US-97).
const BOTTOM_ITEM_BASE = 'flex min-w-0 flex-1 basis-0 flex-col items-center gap-0.5 px-0.5 py-2';

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
  const panelRef = useFocusTrap<HTMLDivElement>(moreOpen);

  // Escape cierra el panel (US-235): antes solo se podía cerrar tocando fuera o
  // la X, y con teclado no había salida.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [moreOpen]);

  return (
    <>
      {/* Panel "Más" — resto de secciones */}
      {moreOpen && (
        <div className="fixed inset-0 z-20 md:hidden" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/30" aria-hidden="true" />
          {/* US-235: era un `div` suelto — sin rol, sin nombre y sin Escape. Ahora
              es un diálogo de verdad: se anuncia como tal, atrapa el foco (mismo
              hook que Slideover/Dialog, US-62) y se cierra con Escape. */}
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="mas-secciones-titulo"
            className="absolute inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] rounded-t-xl border-t border-kr bg-kr-elevated p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span
                id="mas-secciones-titulo"
                className="text-kr-base font-semibold text-kr-primary"
              >
                {t('layout.moreSections')}
              </span>
              <button
                type="button"
                aria-label={t('common.close')}
                onClick={() => setMoreOpen(false)}
                className="relative tap-target -m-2 p-2 text-kr-secondary"
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
            <span className="w-full truncate text-center text-kr-xs leading-tight">
              {t(labelKey)}
            </span>
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          aria-label={t('layout.more')}
          className={cn(BOTTOM_ITEM_BASE, moreOpen ? 'text-kr-link' : 'text-kr-secondary')}
        >
          <MoreHorizontal className="h-5 w-5 shrink-0" />
          <span className="w-full truncate text-center text-kr-xs leading-tight">
            {t('layout.more')}
          </span>
        </button>
      </nav>
    </>
  );
}

export function AppLayout() {
  const t = useT();
  const logout = useAuthStore((s) => s.logout);
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');

  // Refleja el estado real del stream Socket.io en el indicador de conexión (US-94).
  useEffect(() => useConnectionStore.getState().subscribe(), []);

  // El agente emite `inventory:snapshot` UNA vez por conexión. La suscripción vive aquí, con el
  // mismo ciclo de vida que el socket y registrada antes de que se retrase el Outlet: si la hiciera
  // cada página, el snapshot llegaría antes de que existiera el listener y el inventario quedaría
  // vacío hasta el siguiente barrido.
  useEffect(() => useInventoryStore.getState().subscribe(), []);

  // Estado de cada dominio (conectado / demostración / sin configurar), una sola lectura para
  // la barra lateral y todas las páginas (ver `lib/integration-states.ts`).
  useSincronizarEstados();
  const estadosListos = useEstadosListos();

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  // Título del documento + foco al contenido en cada navegación (US-235). En una
  // SPA el navegador no hace ninguna de las dos cosas por su cuenta.
  const mainRef = useRef<HTMLElement>(null);
  useRouteAnnounce(mainRef);

  return (
    <div className="flex min-h-dvh bg-kr-base text-kr-primary">
      {/* Skip-link (US-235): con teclado había que tabular por toda la navegación
          en CADA vista antes de llegar al contenido. Invisible hasta enfocarlo. */}
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-70 focus:rounded-md focus:bg-kr-accent focus:px-4 focus:py-2 focus:text-white"
      >
        {t('nav.skipToContent')}
      </a>
      <AppSidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />

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
            className="min-h-11 px-2 text-kr-sm text-kr-secondary hover:text-kr-primary md:min-h-0 md:px-0"
          >
            {t('common.logout')}
          </button>
        </header>

        {/* La `key` por ruta reinicia el fade en cada navegación (transición sutil,
            US-160). motion-reduce desactiva el desplazamiento. */}
        {/* `tabIndex={-1}`: enfocable por código (al cambiar de ruta) pero no en el
            orden de tabulación. `outline-hidden` porque el foco aquí es programático
            y un halo alrededor de toda la página sería ruido visual. */}
        <main
          id="contenido"
          ref={mainRef}
          tabIndex={-1}
          key={location.pathname}
          className="flex-1 animate-kr-fade-up pb-[calc(5rem+env(safe-area-inset-bottom))] outline-hidden md:pb-0"
        >
          {/* Sin esperar al estado, una entrada en frío pide los datos de un dominio sin conectar. */}
          {/* Su PROPIO límite de Suspense: el de `App.tsx` envuelve todas las rutas, así que sin este
              una página `lazy()` que se carga después de montar el layout (ahora siempre, porque
              el Outlet espera al estado) hacía caer el layout ENTERO a la pantalla de carga y
              la barra lateral desaparecía. */}
          <Suspense fallback={<CargandoPagina />}>
            {estadosListos ? <Outlet /> : <CargandoPagina />}
          </Suspense>
        </main>

        <MobileBottomNav />
      </div>

      <Toaster />
    </div>
  );
}
