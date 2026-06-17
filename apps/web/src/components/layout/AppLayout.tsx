import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Cpu,
  KeyRound,
  LayoutDashboard,
  Network,
  Settings,
  ShieldAlert,
  Wifi,
} from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
}

/** Secciones del MVP, navegables. */
const SECTIONS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/inventory', label: 'Dispositivos', icon: Network },
  { to: '/wifi', label: 'Red WiFi', icon: Wifi },
  { to: '/vpn', label: 'VPN', icon: KeyRound },
  { to: '/traffic', label: 'Tráfico', icon: Activity },
  { to: '/settings', label: 'Ajustes', icon: Settings },
];

/** Secciones de fases futuras, mostradas pero deshabilitadas. */
const FUTURE: { label: string; icon: LucideIcon; phase: string }[] = [
  { label: 'IoT', icon: Cpu, phase: 'F2' },
  { label: 'Firewall', icon: ShieldAlert, phase: 'F3' },
];

function SidebarLink({ to, label, icon: Icon, end }: NavItem) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-secondary text-secondary-foreground'
            : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground',
        )
      }
    >
      <Icon className="h-4 w-4" />
      {label}
    </NavLink>
  );
}

export function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar — solo desktop */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
        <div className="px-5 py-4 text-lg font-semibold text-primary">KrakenOS</div>
        <nav className="flex-1 space-y-1 px-3">
          {SECTIONS.map((item) => (
            <SidebarLink key={item.to} {...item} />
          ))}
          <div className="px-3 pb-1 pt-4 text-xs font-medium uppercase text-muted-foreground">
            Próximamente
          </div>
          {FUTURE.map(({ label, icon: Icon, phase }) => (
            <div
              key={label}
              className="flex cursor-not-allowed items-center justify-between rounded-md px-3 py-2 text-sm text-muted-foreground/50"
            >
              <span className="flex items-center gap-3">
                <Icon className="h-4 w-4" />
                {label}
              </span>
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px]">{phase}</span>
            </div>
          ))}
        </nav>
        <div className="border-t border-border p-3">
          <div className="mb-2 truncate px-2 text-sm text-muted-foreground">{user?.displayName}</div>
          <Button variant="outline" size="sm" className="w-full" onClick={() => void logout()}>
            Salir
          </Button>
        </div>
      </aside>

      {/* Columna principal */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — solo móvil */}
        <header className="flex items-center justify-between border-b border-border px-4 py-3 md:hidden">
          <span className="text-lg font-semibold text-primary">KrakenOS</span>
          <Button variant="ghost" size="sm" onClick={() => void logout()}>
            Salir
          </Button>
        </header>

        <main className="flex-1 pb-20 md:pb-0">
          <Outlet />
        </main>

        {/* Bottom nav — solo móvil */}
        <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-card md:hidden">
          {SECTIONS.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex flex-1 flex-col items-center gap-1 py-2 text-[11px]',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )
              }
            >
              <Icon className="h-5 w-5" />
              {label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  );
}
