import type { DriverConfig, HardwareDriver } from '@krakenos/types';
import { MockDriver } from './mock.driver.js';

/**
 * Construye el driver de hardware adecuado según la configuración.
 * Los adaptadores reales (OpenWrt, pfSense) se añadirán aquí; el resto del
 * agente sólo conoce la interfaz `HardwareDriver`.
 */
export function createDriver(config: DriverConfig): HardwareDriver {
  switch (config.kind) {
    case 'mock':
      return new MockDriver();
    case 'openwrt':
      throw new Error('Driver OpenWrt aún no implementado');
    case 'pfsense':
      throw new Error('Driver pfSense aún no implementado');
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Driver desconocido: ${String(exhaustive)}`);
    }
  }
}

export { MockDriver } from './mock.driver.js';
