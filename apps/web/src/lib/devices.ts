import type { Device, DeviceType } from '@krakenos/types';

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

export const TYPE_LABELS: Record<DeviceType, string> = {
  router: 'Router',
  computer: 'Ordenador',
  phone: 'Móvil',
  tablet: 'Tablet',
  iot: 'IoT',
  tv: 'TV',
  printer: 'Impresora',
  unknown: 'Desconocido',
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
