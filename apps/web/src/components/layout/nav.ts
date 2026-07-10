import type { LucideIcon } from 'lucide-react';
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
  label: string;
  icon: LucideIcon;
  end?: boolean;
  /** Badge de estado en tiempo real, si aplica. */
  badge?: NavBadgeKey;
}

/** Grupo con cabecera visible en la sidebar (estilo consola de red). */
export interface NavGroup {
  label: string;
  items: NavItem[];
}

// Ítems con identidad estable, para reutilizarlos por referencia en la bottom-nav
// móvil (así `MOBILE_SECONDARY` se deriva por diferencia sin duplicar rutas).
const CONNECT: NavItem = { to: '/connect', label: 'Conectar', icon: PlusCircle };
const DASHBOARD: NavItem = { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true };
const DEVICES: NavItem = { to: '/inventory', label: 'Dispositivos', icon: Network, badge: 'devices' };
const WIFI: NavItem = { to: '/wifi', label: 'Red WiFi', icon: Wifi };
const COVERAGE: NavItem = { to: '/coverage', label: 'Cobertura WiFi', icon: Radar };
const TRAFFIC: NavItem = { to: '/traffic', label: 'Tráfico', icon: Activity };
const ROOMS: NavItem = { to: '/rooms', label: 'Habitaciones', icon: Home };
const SCENES: NavItem = { to: '/scenes', label: 'Escenas', icon: Clapperboard };
const AUTOMATIONS: NavItem = { to: '/automations', label: 'Automatizaciones', icon: Workflow };
const IOT: NavItem = { to: '/iot', label: 'IoT', icon: Cpu, badge: 'iot' };
const CAMERAS: NavItem = { to: '/cameras', label: 'Cámaras', icon: Video };
const VPN: NavItem = { to: '/vpn', label: 'VPN', icon: KeyRound };
const FIREWALL: NavItem = { to: '/firewall', label: 'Firewall', icon: ShieldAlert, badge: 'firewall' };
const VLANS: NavItem = { to: '/vlans', label: 'VLANs', icon: Layers };
const QOS: NavItem = { to: '/qos', label: 'QoS', icon: Gauge };
const DNS: NavItem = { to: '/dns', label: 'DNS', icon: Globe };
const SETTINGS: NavItem = { to: '/settings', label: 'Ajustes', icon: Settings };

/**
 * Navegación por grupos con cabecera (US-163). De lo cotidiano a lo avanzado:
 * General → Red → Hogar → Red avanzada → Sistema. "Compatibilidad" se sacó del
 * menú (es una referencia estática, no una operación): se enlaza desde «Conectar».
 */
export const NAV_GROUPS: NavGroup[] = [
  { label: 'General', items: [CONNECT, DASHBOARD] },
  { label: 'Red', items: [DEVICES, WIFI, COVERAGE, TRAFFIC] },
  { label: 'Hogar', items: [ROOMS, SCENES, AUTOMATIONS, IOT, CAMERAS] },
  { label: 'Red avanzada', items: [VPN, FIREWALL, VLANS, QOS, DNS] },
  { label: 'Sistema', items: [SETTINGS] },
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
      { label: 'General', items: [DASHBOARD] },
      { label: 'Hogar', items: [ROOMS, SCENES, IOT] },
      { label: 'Sistema', items: [SETTINGS] },
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
