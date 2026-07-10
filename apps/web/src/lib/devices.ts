import type { Device, DeviceIcon, DeviceType } from '@krakenos/types';
import { deviceTypeToArtKind, type ProductArtKind } from '@/components/ui/product-art';
import type { TranslationKey } from '@/lib/i18n';

/**
 * Ilustración efectiva de un dispositivo (US-178): el icono elegido a mano
 * prima sobre el inferido por tipo.
 */
export function deviceArtKind(device: Pick<Device, 'icon' | 'type'>): ProductArtKind {
  return (device.icon as ProductArtKind | null) ?? deviceTypeToArtKind(device.type);
}

/** Claves i18n de las etiquetas del catálogo de iconos elegibles (US-178). */
export const DEVICE_ICON_LABELS: Record<DeviceIcon, TranslationKey> = {
  router: 'device.icon.router',
  'access-point': 'device.icon.access-point',
  switch: 'device.icon.switch',
  laptop: 'device.icon.laptop',
  phone: 'device.icon.phone',
  tablet: 'device.icon.tablet',
  tv: 'device.icon.tv',
  printer: 'device.icon.printer',
  'iot-hub': 'device.icon.iot-hub',
  bulb: 'device.icon.bulb',
  plug: 'device.icon.plug',
  camera: 'device.icon.camera',
  sensor: 'device.icon.sensor',
};

export const DEVICE_TYPES: DeviceType[] = [
  'router',
  'computer',
  'phone',
  'tablet',
  'iot',
  'tv',
  'printer',
  'unknown',
];

export const TYPE_LABELS: Record<DeviceType, TranslationKey> = {
  router: 'device.type.router',
  computer: 'device.type.computer',
  phone: 'device.type.phone',
  tablet: 'device.type.tablet',
  iot: 'device.type.iot',
  tv: 'device.type.tv',
  printer: 'device.type.printer',
  unknown: 'device.type.unknown',
};

/** Filtro rápido por estado en la página de inventario (US-43). */
export type ActiveFilter = 'online' | 'offline' | 'blocked' | 'unknown';

const FILTER_PREDICATES: Record<ActiveFilter, (d: Device) => boolean> = {
  online: (d) => d.online && !d.isBlocked,
  offline: (d) => !d.online,
  blocked: (d) => d.isBlocked,
  unknown: (d) => d.type === 'unknown',
};

function matchesQuery(d: Device, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [d.label, d.hostname, d.ip, d.mac, d.vendor].some(
    (value) => value != null && value.toLowerCase().includes(needle),
  );
}

/**
 * Filtra dispositivos por texto libre (`label`/`hostname`/`ip`/`mac`/`vendor`) y por
 * filtros de estado combinables (OR entre los filtros activos). Función pura testeable.
 */
export function filterDevices(
  devices: Device[],
  query: string,
  filters: ActiveFilter[],
): Device[] {
  return devices.filter((d) => {
    if (!matchesQuery(d, query)) return false;
    if (filters.length === 0) return true;
    return filters.some((f) => FILTER_PREDICATES[f](d));
  });
}

/** Agrupa los dispositivos por `DeviceType`, con una clave por cada tipo conocido. */
export function groupDevicesByType(devices: Device[]): Record<DeviceType, Device[]> {
  const groups = Object.fromEntries(DEVICE_TYPES.map((t) => [t, [] as Device[]])) as Record<
    DeviceType,
    Device[]
  >;
  for (const d of devices) groups[d.type].push(d);
  return groups;
}
