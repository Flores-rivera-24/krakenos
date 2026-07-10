import type { LucideIcon } from 'lucide-react';
import type { TranslationKey } from '@/lib/i18n';
import {
  Activity,
  Clapperboard,
  Cpu,
  Gauge,
  Globe,
  Home,
  KeyRound,
  Layers,
  LayoutDashboard,
  Network,
  PlusCircle,
  Radar,
  Settings,
  ShieldAlert,
  Video,
  Wifi,
  Workflow,
} from 'lucide-react';

/** Clave de badge dinámico que puede llevar un ítem de navegación. */
export type NavBadgeKey = 'devices' | 'firewall' | 'iot';

export interface NavItem {
  to: string;
  /** Clave i18n del rótulo (US-177); se traduce al renderizar con `t()`. */
  labelKey: TranslationKey;
  icon: LucideIcon;
  end?: boolean;
  /** Badge de estado en tiempo real, si aplica. */
  badge?: NavBadgeKey;
}

/** Grupo con cabecera visible en la sidebar (estilo consola de red). */
export interface NavGroup {
  /**
   * Identidad estable del grupo (valor en español): se usa para filtrar por
   * rol/modo y como clave en los tests. **No** se muestra directamente — la
   * cabecera visible se traduce con `labelKey` (US-177).
   */
  label: string;
  /** Clave i18n de la cabecera visible (US-177). */
  labelKey: TranslationKey;
  items: NavItem[];
}

// Ítems con identidad estable, para reutilizarlos por referencia en la bottom-nav
// móvil (así `MOBILE_SECONDARY` se deriva por diferencia sin duplicar rutas).
const CONNECT: NavItem = { to: '/connect', labelKey: 'nav.connect', icon: PlusCircle };
const DASHBOARD: NavItem = { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true };
const DEVICES: NavItem = { to: '/inventory', labelKey: 'nav.devices', icon: Network, badge: 'devices' };
const WIFI: NavItem = { to: '/wifi', labelKey: 'nav.wifi', icon: Wifi };
const COVERAGE: NavItem = { to: '/coverage', labelKey: 'nav.coverage', icon: Radar };
const TRAFFIC: NavItem = { to: '/traffic', labelKey: 'nav.traffic', icon: Activity };
const ROOMS: NavItem = { to: '/rooms', labelKey: 'nav.rooms', icon: Home };
const SCENES: NavItem = { to: '/scenes', labelKey: 'nav.scenes', icon: Clapperboard };
const AUTOMATIONS: NavItem = { to: '/automations', labelKey: 'nav.automations', icon: Workflow };
const IOT: NavItem = { to: '/iot', labelKey: 'nav.iot', icon: Cpu, badge: 'iot' };
const CAMERAS: NavItem = { to: '/cameras', labelKey: 'nav.cameras', icon: Video };
const VPN: NavItem = { to: '/vpn', labelKey: 'nav.vpn', icon: KeyRound };
const FIREWALL: NavItem = { to: '/firewall', labelKey: 'nav.firewall', icon: ShieldAlert, badge: 'firewall' };
const VLANS: NavItem = { to: '/vlans', labelKey: 'nav.vlans', icon: Layers };
const QOS: NavItem = { to: '/qos', labelKey: 'nav.qos', icon: Gauge };
const DNS: NavItem = { to: '/dns', labelKey: 'nav.dns', icon: Globe };
const SETTINGS: NavItem = { to: '/settings', labelKey: 'nav.settings', icon: Settings };

/**
 * Navegación por grupos con cabecera (US-163). De lo cotidiano a lo avanzado:
 * General → Red → Hogar → Red avanzada → Sistema.
 */
export const NAV_GROUPS: NavGroup[] = [
  { label: 'General', labelKey: 'nav.group.general', items: [CONNECT, DASHBOARD] },
  { label: 'Red', labelKey: 'nav.group.network', items: [DEVICES, WIFI, COVERAGE, TRAFFIC] },
  { label: 'Hogar', labelKey: 'nav.group.home', items: [ROOMS, SCENES, AUTOMATIONS, IOT, CAMERAS] },
  { label: 'Red avanzada', labelKey: 'nav.group.advanced', items: [VPN, FIREWALL, VLANS, QOS, DNS] },
  { label: 'Sistema', labelKey: 'nav.group.system', items: [SETTINGS] },
];

/** Lista plana de todos los ítems, en orden. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** Los 5 ítems más frecuentes para la bottom-nav móvil. */
export const MOBILE_PRIMARY: NavItem[] = [CONNECT, DASHBOARD, DEVICES, IOT, TRAFFIC];

/** El resto de ítems, accesibles desde el botón "Más" de la bottom-nav. */
export const MOBILE_SECONDARY: NavItem[] = NAV_ITEMS.filter((i) => !MOBILE_PRIMARY.includes(i));

/**
 * Grupos visibles según el rol del hogar (US-179) y el modo de interfaz
 * (US-176) — solo presentación, la autoridad es del servidor:
 * - `admin`/`viewer`: todo (viewer ya ve solo-lectura).
 * - `member`: sin «Red avanzada» (opera el hogar, no gestiona la red).
 * - `kid`/`guest`: UI reducida — Dashboard, Hogar básico y Ajustes (su perfil).
 * - `uiMode === 'simple'`: además, sin «Red avanzada» para cualquier rol
 *   (VPN/Firewall/VLAN/QoS/DNS son jerga de red). Ausente = `advanced`.
 */
export function navGroupsForRole(role?: string, uiMode?: string): NavGroup[] {
  const base =
    uiMode === 'simple' ? NAV_GROUPS.filter((g) => g.label !== 'Red avanzada') : NAV_GROUPS;
  if (role === 'member') return base.filter((g) => g.label !== 'Red avanzada');
  if (role === 'kid' || role === 'guest') {
    return [
      { label: 'General', labelKey: 'nav.group.general', items: [DASHBOARD] },
      { label: 'Hogar', labelKey: 'nav.group.home', items: [ROOMS, SCENES, IOT] },
      { label: 'Sistema', labelKey: 'nav.group.system', items: [SETTINGS] },
    ];
  }
  return base;
}

/** Bottom-nav móvil filtrada al conjunto visible del rol y modo (US-179/US-176). */
export function mobileNavForRole(
  role?: string,
  uiMode?: string,
): { primary: NavItem[]; secondary: NavItem[] } {
  const allowed = new Set(navGroupsForRole(role, uiMode).flatMap((g) => g.items));
  return {
    primary: MOBILE_PRIMARY.filter((i) => allowed.has(i)),
    secondary: MOBILE_SECONDARY.filter((i) => allowed.has(i)),
  };
}
