import { NOT_CONFIGURED_KIND, type DomainState } from '@krakenos/types';
import { iotBackends } from './schema.js';

/**
 * Estado de un dominio a partir del `kind` que tiene **vivo**. Función pura y punto único:
 * el overview de integraciones, la barra lateral y los avisos de las páginas leen esto, no
 * cada uno su propia comparación con `'mock'`.
 *
 * - `none` → `not-configured`: no hay nada conectado.
 * - `mock` → `demo`: datos de demostración. En IoT el `kind` es una lista (`mock,hue`): basta
 *   con que **un** backend sea `mock` para que parte de lo que se enseña sea inventado.
 * - cualquier otro → `configured`.
 */
export function domainStateOf(kind: string): DomainState {
  if (kind.trim() === NOT_CONFIGURED_KIND) return 'not-configured';
  if (iotBackends(kind).includes('mock')) return 'demo';
  return 'configured';
}
