import type { DeviceType } from '@krakenos/types';
import {
  Flame,
  FlaskConical,
  Gauge,
  ShieldBan,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { LaptopArt, PhoneArt, TabletArt, TvArt, PrinterArt, IotHubArt, UnknownArt } from './devices';
import { AccessPointArt, RouterArt, SwitchArt } from './network';
import { ServiceEmblem } from './service';
import type { ArtProps } from './shared';
import { BulbArt, CameraArt, PlugArt, SensorArt } from './smart-home';

export type { ArtProps } from './shared';

/**
 * Catálogo de ilustraciones de producto (US-161). `ProductArt` resuelve un `kind`
 * a su render; los aparatos físicos usan un SVG dedicado y las funciones
 * abstractas (vpn/dns/firewall/qos/demo) un `ServiceEmblem` con su glifo.
 */
export type ProductArtKind =
  | 'router'
  | 'access-point'
  | 'switch'
  | 'laptop'
  | 'phone'
  | 'tablet'
  | 'tv'
  | 'printer'
  | 'iot-hub'
  | 'unknown'
  | 'bulb'
  | 'plug'
  | 'camera'
  | 'sensor'
  | 'vpn'
  | 'dns'
  | 'firewall'
  | 'qos'
  | 'demo';

const DEVICE_ART: Partial<Record<ProductArtKind, ComponentType<ArtProps>>> = {
  router: RouterArt,
  'access-point': AccessPointArt,
  switch: SwitchArt,
  laptop: LaptopArt,
  phone: PhoneArt,
  tablet: TabletArt,
  tv: TvArt,
  printer: PrinterArt,
  'iot-hub': IotHubArt,
  unknown: UnknownArt,
  bulb: BulbArt,
  plug: PlugArt,
  camera: CameraArt,
  sensor: SensorArt,
};

const SERVICE_ICON: Record<'vpn' | 'dns' | 'firewall' | 'qos' | 'demo', LucideIcon> = {
  vpn: ShieldCheck,
  dns: ShieldBan,
  firewall: Flame,
  qos: Gauge,
  demo: FlaskConical,
};

export function ProductArt({
  kind,
  className,
  title,
}: ArtProps & { kind: ProductArtKind }) {
  const Art = DEVICE_ART[kind];
  if (Art) return <Art className={className} title={title} />;
  const icon = SERVICE_ICON[kind as keyof typeof SERVICE_ICON] ?? FlaskConical;
  return <ServiceEmblem icon={icon} className={className} title={title} />;
}

/** Tipo de dispositivo del inventario → ilustración. */
export function deviceTypeToArtKind(type: DeviceType): ProductArtKind {
  switch (type) {
    case 'router':
      return 'router';
    case 'computer':
      return 'laptop';
    case 'phone':
      return 'phone';
    case 'tablet':
      return 'tablet';
    case 'tv':
      return 'tv';
    case 'printer':
      return 'printer';
    case 'iot':
      return 'iot-hub';
    default:
      return 'unknown';
  }
}

/** `kind` de un dispositivo IoT (`light`/`plug`/`sensor`) → ilustración. */
export function iotKindToArtKind(kind: string): ProductArtKind {
  if (kind === 'light') return 'bulb';
  if (kind === 'plug') return 'plug';
  if (kind === 'sensor') return 'sensor';
  return 'iot-hub';
}

/** Los puntos de acceso colocables siempre se renderizan como AP de techo. */
export function apModelToArtKind(): ProductArtKind {
  return 'access-point';
}
