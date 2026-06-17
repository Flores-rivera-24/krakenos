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
  /** `true` si el dispositivo está bloqueado (sin acceso a la red). */
  isBlocked: boolean;
  /** `true` si se vio en el último barrido. */
  online: boolean;
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
}
