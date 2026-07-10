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

/**
 * Potencia de referencia por dispositivo del mock, para que la medición de
 * energía (US-181) tenga datos deterministas en dev/tests. Los enchufes con
 * "carga" declarada consumen esa potencia cuando están encendidos; un aparato
 * apagado consume ~0. Los sensores no miden potencia.
 */
const MOCK_LOAD_W: Record<string, number> = {
  'light-salon': 9,
  'light-dormitorio': 7,
  'plug-cafetera': 900,
  'plug-tv': 120,
};

/**
 * Rellena `powerW` según el estado del dispositivo (US-181): potencia declarada
 * si está encendido (las luces escalan con el brillo), ~0 en standby si apagado,
 * y `null` para lo que no tiene carga conocida (sensores).
 */
function withSimulatedPower(device: IotDevice): IotDevice {
  const load = MOCK_LOAD_W[device.id];
  if (load === undefined || device.on === null) return { ...device, powerW: null };
  if (!device.on) return { ...device, powerW: 0 };
  const scale = device.kind === 'light' && device.brightness !== null ? device.brightness / 100 : 1;
  return { ...device, powerW: Math.round(load * scale * 10) / 10 };
}

/** Integración IoT en memoria para desarrollo. */
export class MockIotManager implements IotManager {
  readonly kind = 'mock' as const;
  private readonly devices = new Map<string, IotDevice>();

  constructor() {
    const seed: IotDevice[] = [
      { id: 'light-salon', name: 'Luz salón', kind: 'light', room: 'Salón', reachable: true, on: true, brightness: 80, color: { hex: '#ffae42', temperatureK: null }, reading: null },
      { id: 'light-dormitorio', name: 'Luz dormitorio', kind: 'light', room: 'Dormitorio', reachable: true, on: false, brightness: 50, color: { hex: null, temperatureK: 2700 }, reading: null },
      { id: 'plug-cafetera', name: 'Cafetera', kind: 'plug', room: 'Cocina', reachable: true, on: false, brightness: null, color: null, reading: null },
      { id: 'plug-tv', name: 'TV', kind: 'plug', room: 'Salón', reachable: true, on: true, brightness: null, color: null, reading: null },
      { id: 'sensor-temp', name: 'Temperatura salón', kind: 'sensor', room: 'Salón', reachable: true, on: null, brightness: null, color: null, reading: { metric: 'temperatura', value: 21.5, unit: '°C' } },
      { id: 'sensor-hum', name: 'Humedad', kind: 'sensor', room: 'Salón', reachable: true, on: null, brightness: null, color: null, reading: { metric: 'humedad', value: 45, unit: '%' } },
    ];
    for (const d of seed) {
      const withPower = withSimulatedPower(d);
      this.devices.set(withPower.id, withPower);
    }
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
    // Color solo en luces con color (color !== null).
    if (input.color !== undefined && device.kind === 'light' && device.color !== null) {
      if (input.color.hex !== undefined) next.color = { hex: input.color.hex, temperatureK: null };
      else if (input.color.temperatureK !== undefined) {
        next.color = { hex: null, temperatureK: input.color.temperatureK };
      }
    }
    const withPower = withSimulatedPower(next);
    this.devices.set(id, withPower);
    return withPower;
  }
}
