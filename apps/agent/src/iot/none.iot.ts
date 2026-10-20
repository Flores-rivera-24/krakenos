import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';
import { DomainNotConfiguredError } from '../integrations/not-configured.js';

/**
 * IoT «sin configurar» (`IOT_KIND=none`): no hay ningún backend conectado (ni Hue, ni
 * Zigbee, ni Matter…), así que no hay aparatos. Mandar un cambio de estado es un 409.
 *
 * Va sin el envoltorio de `CompositeIotManager` a propósito: el composite prefija los ids
 * con el backend (`hue:foco-1`) y aquí no hay backend ni ids. `notConfigured` lo leen los
 * consumidores que no deben tratar «sin aparatos» como «aparatos que han desaparecido»
 * (la alarma) y la migración de ids, que no debe darse por hecha contra un IoT inexistente.
 */
export class NoneIotManager implements IotManager {
  readonly kind = 'none' as const;
  readonly notConfigured = true as const;

  async listDevices(): Promise<IotDevice[]> {
    return [];
  }

  async getDevice(_id: string): Promise<IotDevice | null> {
    return null;
  }

  async setState(_id: string, _input: UpdateIotStateRequest): Promise<IotDevice> {
    throw new DomainNotConfiguredError('iot');
  }
}
