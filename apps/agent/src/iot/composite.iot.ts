import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';
import { IotError } from './mock.iot.js';

/** Una integración miembro del composite, con su prefijo de id. */
export interface CompositeEntry {
  /** Prefijo de id, p. ej. `hue` o `govee` (sin `:`). */
  prefix: string;
  manager: IotManager;
}

/** Separa un id compuesto `<prefijo>:<idReal>` (por el primer `:`). */
function splitId(id: string): { prefix: string; bareId: string } | null {
  const i = id.indexOf(':');
  if (i === -1) return null;
  return { prefix: id.slice(0, i), bareId: id.slice(i + 1) };
}

/**
 * Agrega varias integraciones IoT (Hue + Govee + …) tras una sola interfaz
 * `IotManager`. Cada dispositivo se expone con su id **prefijado** (`hue:<id>`)
 * para poder enrutar `getDevice`/`setState` al manager correcto. Permite tener
 * varios backends activos a la vez (lo que un único `IOT_KIND` no cubría).
 */
export class CompositeIotManager implements IotManager {
  readonly kind = 'composite' as const;

  constructor(private readonly entries: CompositeEntry[]) {}

  /** Arranca en segundo plano los miembros que lo necesiten (no bloquea). */
  async start(): Promise<void> {
    for (const { manager } of this.entries) {
      const startable = manager as { start?: () => Promise<void> };
      startable.start?.().catch(() => undefined);
    }
  }

  private prefixed(prefix: string, device: IotDevice): IotDevice {
    return { ...device, id: `${prefix}:${device.id}` };
  }

  async listDevices(): Promise<IotDevice[]> {
    const lists = await Promise.all(
      this.entries.map(async ({ prefix, manager }) =>
        (await manager.listDevices()).map((d) => this.prefixed(prefix, d)),
      ),
    );
    return lists.flat();
  }

  async getDevice(id: string): Promise<IotDevice | null> {
    const split = splitId(id);
    const entry = split && this.entries.find((e) => e.prefix === split.prefix);
    if (!split || !entry) return null;
    const device = await entry.manager.getDevice(split.bareId);
    return device ? this.prefixed(entry.prefix, device) : null;
  }

  async setState(id: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    const split = splitId(id);
    const entry = split && this.entries.find((e) => e.prefix === split.prefix);
    if (!split || !entry) throw new IotError('IOT_NOT_FOUND', 'Dispositivo no encontrado');
    return this.prefixed(entry.prefix, await entry.manager.setState(split.bareId, input));
  }
}
