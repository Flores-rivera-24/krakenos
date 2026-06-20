import type { Device } from '@krakenos/types';
import { ChevronLeft, ChevronRight, LogOut } from 'lucide-react';
import { Fragment } from 'react';
import { NavLink } from 'react-router-dom';
import { StatusDot } from '@/components/ui/status-dot';
import { formatUptime } from '@/lib/format';
import type { SidebarStats } from '@/lib/sidebar-stats';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { useInventoryStore } from '@/store/inventory.store';
import { NAV_GROUPS, type NavBadgeKey, type NavItem } from './nav';

/** Cuenta de dispositivos desconocidos o bloqueados (badge de "Dispositivos"). */
function unknownOrBlockedCount(devices: Record<string, Device>): number {
  return Object.values(devices).filter((d) => d.type === 'unknown' || d.isBlocked).length;
}

function badgeValue(key: NavBadgeKey, devicesBadge: number, stats: SidebarStats): number {
  if (key === 'devices') return devicesBadge;
  if (key === 'firewall') return stats.firewallActive;
  return stats.iotOffline;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

interface SidebarItemProps {
  item: NavItem;
  collapsed: boolean;
  badge: number;
}

function SidebarItem({ item, collapsed, badge }: SidebarItemProps) {
  const { to, label, icon: Icon, end } = item;
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          'group flex items-center gap-3 rounded-lg px-3 py-2 text-kr-base transition-colors',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-kr-elevated text-kr-primary'
            : 'text-kr-secondary hover:bg-kr-elevated hover:text-kr-primary',
        )
      }
    >
      <Icon className="h-5 w-5 shrink-0" />
      {!collapsed && <span className="flex-1 truncate">{label}</span>}
      {item.badge && badge > 0 && (
        <span
          className={cn(
            'rounded-full bg-kr-accent px-1.5 py-0.5 text-kr-xs font-semibold text-white',
            collapsed && 'absolute right-1 top-1 px-1 py-0',
          )}
          aria-label={`${badge}`}
        >
          {badge}
        </span>
      )}
    </NavLink>
  );
}

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  stats: SidebarStats;
}

export function AppSidebar({ collapsed, onToggle, stats }: AppSidebarProps) {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const devices = useInventoryStore((s) => s.devices);
  const devicesBadge = unknownOrBlockedCount(devices);

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        'relative hidden shrink-0 flex-col border-r border-kr bg-kr-surface transition-[width] duration-200 md:flex',
        collapsed ? 'w-16' : 'w-[220px]',
      )}
    >
      {/* Marca + toggle de colapso */}
      <div className="flex h-14 items-center justify-between px-4">
        {!collapsed && <span className="text-kr-lg font-semibold text-kr-primary">KrakenOS</span>}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expandir menú' : 'Colapsar menú'}
          className="flex h-7 w-7 items-center justify-center rounded-md text-kr-secondary hover:bg-kr-elevated hover:text-kr-primary"
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>

      {/* Navegación por grupos */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {NAV_GROUPS.map((group, gi) => (
          <Fragment key={gi}>
            {gi > 0 && <div className="my-2 border-t border-kr-muted" />}
            {group.map((item) => (
              <div key={item.to} className="relative">
                <SidebarItem
                  item={item}
                  collapsed={collapsed}
                  badge={item.badge ? badgeValue(item.badge, devicesBadge, stats) : 0}
                />
              </div>
            ))}
          </Fragment>
        ))}
      </nav>

      {/* Zona inferior: driver, uptime, usuario, logout */}
      <div className="space-y-3 border-t border-kr p-3">
        <div className={cn('flex items-center gap-2', collapsed && 'justify-center')}>
          <StatusDot status={stats.online ? 'online' : 'danger'} />
          {!collapsed && (
            <div className="min-w-0 text-kr-sm">
              <div className="truncate text-kr-secondary">
                Driver: <span className="text-kr-primary">{stats.driver ?? '—'}</span>
              </div>
              {stats.uptimeSeconds != null && (
                <div className="text-kr-xs text-kr-muted">
                  Uptime {formatUptime(stats.uptimeSeconds)}
                </div>
              )}
            </div>
          )}
        </div>

        <div className={cn('flex items-center gap-2', collapsed && 'justify-center')}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-kr-elevated text-kr-sm font-semibold text-kr-primary">
            {user ? initials(user.displayName) : '?'}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-kr-sm text-kr-primary">{user?.displayName}</div>
              <div className="truncate text-kr-xs text-kr-muted">{user?.email}</div>
            </div>
          )}
          <button
            type="button"
            onClick={() => void logout()}
            aria-label="Salir"
            title="Salir"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-kr-secondary hover:bg-kr-elevated hover:text-danger"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
