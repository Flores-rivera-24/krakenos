import type { DeviceType } from '@krakenos/types';

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
