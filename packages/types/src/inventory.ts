import type { Id, IsoDateTime } from './common.js';

/** Categoría inferida del dispositivo. */
export type DeviceType =
  | 'router'
  | 'computer'
  | 'phone'
  | 'tablet'
  | 'iot'
  | 'tv'
  | 'printer'
  | 'unknown';

/** Cómo se descubrió o actualizó el dispositivo. */
export type DiscoverySource = 'arp' | 'mdns' | 'manual';

/** Dispositivo presente en la red doméstica. */
/**
 * Iconos elegibles por dispositivo (US-178): claves del catálogo `ProductArt`
 * del frontend (solo los aparatos físicos). Fuente única — los schemas derivan.
 */
export const DEVICE_ICONS = [
  'router',
  'access-point',
  'switch',
  'laptop',
  'phone',
  'tablet',
  'tv',
  'printer',
  'iot-hub',
  'bulb',
  'plug',
  'camera',
  'sensor',
] as const;

export type DeviceIcon = (typeof DEVICE_ICONS)[number];

export interface Device {
  id: Id;
  /** Dirección MAC normalizada (minúsculas, separada por `:`). */
  mac: string;
  /** Última IP conocida. */
  ip: string;
  /** Hostname resuelto vía mDNS/DNS, si se conoce. */
  hostname: string | null;
  /** Nombre asignado por el usuario (tiene prioridad en la UI). */
  label: string | null;
  /** Notas libres del usuario sobre el dispositivo. */
  notes: string | null;
  /** Fabricante derivado del OUI de la MAC. */
  vendor: string | null;
  type: DeviceType;
  /** Icono elegido a mano (US-178), o `null` = inferido del tipo. */
  icon: DeviceIcon | null;
  /**
   * Sugerencia de tipo para un dispositivo aún `unknown` (US-178): heurística
   * OUI/hostname del agente (`identify.ts`); `null` si no hay pista o el tipo
   * ya está identificado. La app pregunta, el usuario confirma.
   */
  suggestedType?: DeviceType | null;
  /** `true` si el dispositivo está bloqueado (sin acceso a la red). */
  isBlocked: boolean;
  /** Pausa de internet activa hasta este instante (US-111), o `null`/ausente si no hay pausa. */
  pausedUntil?: IsoDateTime | null;
  /** `true` si se vio en el último barrido. */
  online: boolean;
  /** VLAN (tag 802.1Q) a la que está asignado, o `null` si ninguna. */
  vlanTag: number | null;
  /** Habitación asignada (US-165), o `null` si ninguna. */
  roomId: string | null;
  /** Persona del hogar dueña del dispositivo (US-179; base de presencia US-169). */
  ownerId: string | null;
  sources: DiscoverySource[];
  firstSeen: IsoDateTime;
  lastSeen: IsoDateTime;
}

/** Dispositivo crudo emitido por un barrido del driver antes de persistir. */
export interface DiscoveredDevice {
  mac: string;
  ip: string;
  hostname?: string | null;
  vendor?: string | null;
  source: DiscoverySource;
}

/** Petición para editar metadatos editables por el usuario. */
export interface UpdateDeviceRequest {
  label?: string | null;
  type?: DeviceType;
  notes?: string | null;
  /** Icono manual (US-178); `null` vuelve al inferido por tipo. */
  icon?: DeviceIcon | null;
  /** Dueño del dispositivo (US-179); `null` lo desasigna. */
  ownerId?: string | null;
}
