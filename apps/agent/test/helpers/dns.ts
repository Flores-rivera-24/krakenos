import { vi } from 'vitest';

/**
 * Fábrica para `vi.mock('node:dns/promises', …)` en los tests que suscriben o envían push.
 *
 * `assertPushEndpointAllowed` resuelve el host del endpoint con DNS REAL. `push.example` no
 * existe: cada suscripción o envío dependía del resolver del runner, y uno lento (>5 s) agotaba
 * el timeout del test y dejaba filas en vuelo que veía el siguiente. Aquí resuelve a una IP
 * pública fija. `vi.mock` se iza por fichero, así que cada test lo declara con
 * `vi.mock('node:dns/promises', () => import('../helpers/dns.js').then((m) => m.dnsPublicoFijo()))`.
 * No va en un setup global: `push-endpoint` y `egress` prueban justo la resolución.
 */
export function dnsPublicoFijo() {
  return {
    lookup: vi.fn(() => Promise.resolve([{ address: '93.184.216.34', family: 4 }])),
  };
}
