import type { Device } from '@krakenos/types';
import { ChevronLeft, LogOut } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { LogoMark } from '@/components/ui/logo';
import { StatusDot } from '@/components/ui/status-dot';
import { ConnectionStatus } from '@/components/layout/ConnectionStatus';
import { formatUptime } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { useSidebarStats, type SidebarStats } from '@/lib/sidebar-stats';
import { useIsMobile } from '@/lib/use-is-mobile';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/store/auth.store';
import { useInventoryStore } from '@/store/inventory.store';
import { navGroupsForRole, type NavBadgeKey, type NavItem } from './nav';
import { ThemeToggle } from './ThemeToggle';

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
  const t = useT();
  const { to, labelKey, icon: Icon, end } = item;
  const label = t(labelKey);
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? label : undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-kr-base transition-all duration-150',
          collapsed && 'justify-center px-0',
          isActive
            ? 'bg-kr-elevated text-kr-primary shadow-kr-glow-sm'
            : 'text-kr-secondary hover:bg-kr-elevated hover:text-kr-primary',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* Barra de acento del ítem activo (estilo consola). */}
          {isActive && (
            <span
              aria-hidden
              className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-kr-accent"
            />
          )}
          <Icon
            className={cn(
              'h-5 w-5 shrink-0 transition-colors',
              isActive && 'text-kr-accent',
            )}
          />
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
        </>
      )}
    </NavLink>
  );
}

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function AppSidebar({ collapsed, onToggle }: AppSidebarProps) {
  // US-239 (AUD3-27): el sondeo vivía en `AppLayout`, que se monta SIEMPRE, así
  // que en móvil se pedían 4 endpoints cada 8 s para una barra lateral que es
  // `hidden md:flex` y no se pinta. Ahora lo pide quien lo usa, y solo si se ve.
  const esMovil = useIsMobile();
  const stats = useSidebarStats(8000, !esMovil);
  const t = useT();
  const user = useAuthStore((s) => s.user);
  // UI reducida por rol (US-179) y por modo sencillo (US-176).
  const navGroups = navGroupsForRole(user?.role, user?.uiMode);
  const simpleMode = user?.uiMode === 'simple';
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
        {collapsed ? (
          // Colapsada: el isotipo actúa como botón para expandir.
          <button
            type="button"
            onClick={onToggle}
            aria-label={t('layout.expandMenu')}
            className="mx-auto flex h-8 w-8 items-center justify-center rounded-md text-kr-accent hover:bg-kr-elevated"
          >
            <LogoMark className="h-6 w-6" />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <LogoMark className="h-6 w-6 text-kr-accent" />
              <span className="text-kr-lg font-semibold text-kr-primary">KrakenOS</span>
            </div>
            <button
              type="button"
              onClick={onToggle}
              aria-label={t('layout.collapseMenu')}
              className="flex h-7 w-7 items-center justify-center rounded-md text-kr-secondary hover:bg-kr-elevated hover:text-kr-primary"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {/* Navegación por grupos con cabecera (US-163) */}
      <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-2">
        {navGroups.map((group, gi) => (
          <div key={group.label} className="space-y-1">
            {collapsed ? (
              gi > 0 && <div className="mx-2 my-1.5 border-t border-kr-muted" />
            ) : (
              <p className="px-3 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-kr-muted">
                {t(group.labelKey)}
              </p>
            )}
            {group.items.map((item) => (
              <div key={item.to} className="relative">
                <SidebarItem
                  item={item}
                  collapsed={collapsed}
                  badge={item.badge ? badgeValue(item.badge, devicesBadge, stats) : 0}
                />
              </div>
            ))}
          </div>
        ))}
      </nav>

      {/* Zona inferior: conexión en vivo, driver, uptime, usuario, logout */}
      <div className="space-y-3 border-t border-kr p-3">
        {/* Estado real del stream en tiempo real (US-94). */}
        <ConnectionStatus collapsed={collapsed} />

        <div className={cn('flex items-center gap-2', collapsed && 'justify-center')}>
          <StatusDot status={stats.online ? 'online' : 'danger'} />
          {!collapsed && (
            <div className="min-w-0 text-kr-sm">
              {/* En modo sencillo (US-176) la jerga técnica (driver/uptime) se
                  sustituye por un estado llano; el punto de estado se mantiene. */}
              {simpleMode ? (
                <div className="truncate text-kr-secondary">
                  {stats.online ? t('layout.homeConnected') : t('layout.noRouterConnection')}
                </div>
              ) : (
                <>
                  <div className="truncate text-kr-secondary">
                    {t('layout.driver')}: <span className="text-kr-primary">{stats.driver ?? '—'}</span>
                  </div>
                  {stats.uptimeSeconds != null && (
                    <div className="text-kr-xs text-kr-muted">
                      {t('layout.uptime')} {formatUptime(stats.uptimeSeconds)}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <ThemeToggle collapsed={collapsed} />

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
            aria-label={t('common.logout')}
            title={t('common.logout')}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-kr-secondary hover:bg-kr-elevated hover:text-danger"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
