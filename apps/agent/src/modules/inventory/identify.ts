import type { DeviceType } from '@krakenos/types';

/**
 * Heurística para inferir el tipo de dispositivo a partir del fabricante y el
 * hostname. Es un mejor esfuerzo; el usuario siempre puede corregirlo.
 */
export function inferDeviceType(vendor: string | null, hostname: string | null): DeviceType {
  const h = (hostname ?? '').toLowerCase();
  const v = (vendor ?? '').toLowerCase();

  const has = (...words: string[]) => words.some((w) => h.includes(w));

  if (has('router', 'gateway', 'ap-', 'unifi', 'openwrt', 'pfsense')) return 'router';
  if (has('iphone')) return 'phone';
  if (has('ipad', 'tablet')) return 'tablet';
  if (has('tv', 'roku', 'chromecast', 'firetv', 'appletv', 'bravia')) return 'tv';
  if (has('printer', 'epson', 'canon', 'hp-', 'brother')) return 'printer';

  if (v === 'ubiquiti') return 'router';
  if (v === 'espressif') return 'iot';
  if (v === 'google' || v === 'amazon' || v === 'roku') return 'iot';
  if (v === 'raspberry pi') return 'computer';
  if (v === 'apple' || v === 'intel') return 'computer';

  return 'unknown';
}
