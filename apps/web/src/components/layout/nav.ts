import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Cpu,
  Gauge,
  Globe,
  KeyRound,
  Layers,
  LayoutDashboard,
  Map,
  Network,
  Settings,
  ShieldAlert,
  Video,
  Wifi,
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

/** Grupos de navegación (separadores visuales en la sidebar, estilo UniFi). */
export const NAV_GROUPS: NavItem[][] = [
  [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/inventory', label: 'Dispositivos', icon: Network, badge: 'devices' },
    { to: '/wifi', label: 'Red WiFi', icon: Wifi },
  ],
  [
    { to: '/iot', label: 'IoT', icon: Cpu, badge: 'iot' },
    { to: '/cameras', label: 'Cámaras', icon: Video },
    { to: '/traffic', label: 'Tráfico', icon: Activity },
  ],
  [
    { to: '/vpn', label: 'VPN', icon: KeyRound },
    { to: '/firewall', label: 'Firewall', icon: ShieldAlert, badge: 'firewall' },
    { to: '/vlans', label: 'VLANs', icon: Layers },
    { to: '/qos', label: 'QoS', icon: Gauge },
    { to: '/dns', label: 'DNS', icon: Globe },
  ],
  [
    { to: '/compatibility', label: 'Compatibilidad', icon: Map },
    { to: '/settings', label: 'Ajustes', icon: Settings },
  ],
];

/** Lista plana de todos los ítems, en orden. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flat();

/** Los 5 ítems más frecuentes para la bottom-nav móvil. */
export const MOBILE_PRIMARY: NavItem[] = [
  NAV_GROUPS[0]![0]!, // Dashboard
  NAV_GROUPS[0]![1]!, // Dispositivos
  NAV_GROUPS[0]![2]!, // Red WiFi
  NAV_GROUPS[1]![0]!, // IoT
  NAV_GROUPS[1]![2]!, // Tráfico
];

/** El resto de ítems, accesibles desde el botón "Más" de la bottom-nav. */
export const MOBILE_SECONDARY: NavItem[] = NAV_ITEMS.filter(
  (i) => !MOBILE_PRIMARY.includes(i),
);
