import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';

/** Error de dominio IoT con código estable. */
export class IotError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Integración IoT en memoria para desarrollo. */
export class MockIotManager implements IotManager {
  readonly kind = 'mock' as const;
  private readonly devices = new Map<string, IotDevice>();

  constructor() {
    const seed: IotDevice[] = [
      { id: 'light-salon', name: 'Luz salón', kind: 'light', room: 'Salón', reachable: true, on: true, brightness: 80, reading: null },
      { id: 'light-dormitorio', name: 'Luz dormitorio', kind: 'light', room: 'Dormitorio', reachable: true, on: false, brightness: 50, reading: null },
      { id: 'plug-cafetera', name: 'Cafetera', kind: 'plug', room: 'Cocina', reachable: true, on: false, brightness: null, reading: null },
      { id: 'plug-tv', name: 'TV', kind: 'plug', room: 'Salón', reachable: true, on: true, brightness: null, reading: null },
      { id: 'sensor-temp', name: 'Temperatura salón', kind: 'sensor', room: 'Salón', reachable: true, on: null, brightness: null, reading: { metric: 'temperatura', value: 21.5, unit: '°C' } },
      { id: 'sensor-hum', name: 'Humedad', kind: 'sensor', room: 'Salón', reachable: true, on: null, brightness: null, reading: { metric: 'humedad', value: 45, unit: '%' } },
    ];
    for (const d of seed) this.devices.set(d.id, d);
  }

  async listDevices(): Promise<IotDevice[]> {
    return [...this.devices.values()];
  }

  async getDevice(id: string): Promise<IotDevice | null> {
    return this.devices.get(id) ?? null;
  }

  async setState(id: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    const device = this.devices.get(id);
    if (!device) throw new IotError('IOT_NOT_FOUND', 'Dispositivo no encontrado');
    if (device.kind === 'sensor') {
      throw new IotError('IOT_NOT_CONTROLLABLE', 'Un sensor no se puede controlar');
    }

    const next: IotDevice = { ...device };
    if (input.on !== undefined) next.on = input.on;
    if (input.brightness !== undefined && device.kind === 'light') {
      next.brightness = input.brightness;
      // Ajustar brillo enciende la luz.
      if (input.on === undefined) next.on = input.brightness > 0;
    }
    this.devices.set(id, next);
    return next;
  }
}
