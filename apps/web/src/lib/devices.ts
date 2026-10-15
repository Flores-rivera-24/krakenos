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

/**
 * Etiquetas humanas del catálogo de iconos elegibles (US-178). Guardan la
 * **clave** del catálogo, no el texto: una constante de módulo con el texto ya
 * resuelto se congelaría con el idioma que hubiera al importar el módulo.
 */
export const DEVICE_ICON_LABEL_KEYS: Record<DeviceIcon, TranslationKey> = {
  router: 'device.iconName.router',
  'access-point': 'device.iconName.accessPoint',
  switch: 'device.iconName.switch',
  laptop: 'device.iconName.laptop',
  phone: 'device.iconName.phone',
  tablet: 'device.iconName.tablet',
  tv: 'device.iconName.tv',
  printer: 'device.iconName.printer',
  'iot-hub': 'device.iconName.iotHub',
  bulb: 'device.iconName.bulb',
  plug: 'device.iconName.plug',
  camera: 'device.iconName.camera',
  sensor: 'device.iconName.sensor',
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

/** Etiqueta de cada tipo de dispositivo: la clave del catálogo, no el texto. */
export const TYPE_LABEL_KEYS: Record<DeviceType, TranslationKey> = {
  router: 'device.typeName.router',
  computer: 'device.typeName.computer',
  phone: 'device.typeName.phone',
  tablet: 'device.typeName.tablet',
  iot: 'device.typeName.iot',
  tv: 'device.typeName.tv',
  printer: 'device.typeName.printer',
  unknown: 'device.typeName.unknown',
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
export function filterDevices(devices: Device[], query: string, filters: ActiveFilter[]): Device[] {
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
