import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';
import { isControllableKind } from '@krakenos/types';

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
      { id: 'light-salon', name: 'Luz salón', kind: 'light', room: 'Salón', reachable: true, on: true, brightness: 80, color: { hex: '#ffae42', temperatureK: null }, readings: [] },
      { id: 'light-dormitorio', name: 'Luz dormitorio', kind: 'light', room: 'Dormitorio', reachable: true, on: false, brightness: 50, color: { hex: null, temperatureK: 2700 }, readings: [] },
      { id: 'plug-cafetera', name: 'Cafetera', kind: 'plug', room: 'Cocina', reachable: true, on: false, brightness: null, color: null, readings: [] },
      { id: 'plug-tv', name: 'TV', kind: 'plug', room: 'Salón', reachable: true, on: true, brightness: null, color: null, readings: [] },
      // Un solo aparato con DOS lecturas: es el caso que el contrato viejo no
      // podía representar y por el que `readings` es una lista (US-244).
      { id: 'sensor-clima', name: 'Clima salón', kind: 'sensor', room: 'Salón', reachable: true, on: null, brightness: null, color: null, readings: [{ metric: 'temperature', value: 21.5, unit: '°C' }, { metric: 'humidity', value: 45, unit: '%' }] },
      // Categorías nuevas de US-244, para que el modo `mock` las enseñe sin hardware.
      { id: 'contact-puerta', name: 'Puerta de entrada', kind: 'contact', room: 'Entrada', reachable: true, on: null, brightness: null, color: null, readings: [{ metric: 'contact', value: 0, unit: '' }, { metric: 'battery', value: 92, unit: '%' }] },
      { id: 'smoke-cocina', name: 'Detector de humo', kind: 'smoke', room: 'Cocina', reachable: true, on: null, brightness: null, color: null, readings: [{ metric: 'smoke', value: 0, unit: '' }, { metric: 'battery', value: 78, unit: '%' }] },
      { id: 'cover-salon', name: 'Persiana salón', kind: 'cover', room: 'Salón', reachable: true, on: null, brightness: null, color: null, readings: [], position: 60 },
      { id: 'climate-salon', name: 'Termostato', kind: 'climate', room: 'Salón', reachable: true, on: null, brightness: null, color: null, readings: [{ metric: 'temperature', value: 20.5, unit: '°C' }], targetC: 21 },
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
    // US-244: la lista de lo controlable vive en `@krakenos/types`, no aquí. Antes
    // se comprobaba `kind === 'sensor'`, así que las categorías nuevas habrían
    // pasado el filtro por omisión — incluida `lock`, que es la que no debe.
    if (!isControllableKind(device.kind)) {
      throw new IotError('IOT_NOT_CONTROLLABLE', 'Este dispositivo no se puede controlar');
    }

    const next: IotDevice = { ...device };
    if (input.position !== undefined && device.kind === 'cover') {
      next.position = Math.max(0, Math.min(100, input.position));
    }
    if (input.targetC !== undefined && device.kind === 'climate') next.targetC = input.targetC;
    if (input.on !== undefined && (device.kind === 'light' || device.kind === 'plug')) {
      next.on = input.on;
    }
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
