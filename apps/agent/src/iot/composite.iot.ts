import type {
  IotDevice,
  IotManager,
  MatterCommissionResult,
  UpdateIotStateRequest,
} from '@krakenos/types';
import { isControllableKind } from '@krakenos/types';
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

  /**
   * Miembros del composite. Desde US-243 **todo** manager va envuelto aquí —
   * también cuando hay un solo backend— así que esta es la única vía para saber
   * qué integración concreta hay detrás (diagnóstico y tests).
   */
  get members(): readonly CompositeEntry[] {
    return this.entries;
  }

  /**
   * Arranca los miembros que lo necesiten.
   *
   * ⚠️ **Espera a que terminen** (best-effort: un miembro que falle no tumba al
   * resto). Antes lanzaba sin `await`, y como desde US-243 **todo** manager va
   * envuelto aquí, eso devolvía el control al instante y reabría por detrás lo que
   * US-242 cerró: «Probar conexión» respondía sin haber arrancado el backend.
   * Quien no quiera bloquearse —el arranque del servidor— ya lo llama sin esperar.
   */
  async start(): Promise<void> {
    await Promise.allSettled(
      this.entries.map(({ manager }) => (manager as { start?: () => Promise<void> }).start?.()),
    );
  }

  /** Libera las conexiones de todos los miembros, best-effort (US-201). */
  async stop(): Promise<void> {
    await Promise.allSettled(this.entries.map(({ manager }) => manager.stop?.()));
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

  /**
   * Enruta la orden al backend dueño del id… **después** de comprobar que la
   * categoría del aparato acepta órdenes (US-246, `docs/adr-cerraduras.md`).
   *
   * El guard vive aquí y no en cada backend porque desde US-243 **todo** manager
   * va envuelto en el composite, también cuando hay uno solo: este es el único
   * punto por el que pasan las órdenes de las rutas, las escenas, los horarios,
   * las automatizaciones y el control entrante de Home Assistant. Ponerlo en cada
   * backend obligaba a nueve copias de la misma regla —y ocho de ellas ni
   * siquiera tienen el `kind` a mano en `setState`, así que la copia habría sido
   * decorativa—; peor aún, un backend nuevo heredaría «controlable» por omisión,
   * que es exactamente como se abre una puerta sin que nadie decida abrirla.
   *
   * Se consulta el aparato para conocer su categoría. Si no se puede leer, la
   * orden **pasa**: negar por un fallo de lectura dejaría la casa sin control cada
   * vez que un bridge tarde en responder, y el backend sigue teniendo la última
   * palabra sobre lo que acepta.
   */
  async setState(id: string, input: UpdateIotStateRequest): Promise<IotDevice> {
    const split = splitId(id);
    const entry = split && this.entries.find((e) => e.prefix === split.prefix);
    if (!split || !entry) throw new IotError('IOT_NOT_FOUND', 'Dispositivo no encontrado');

    const device = await entry.manager.getDevice(split.bareId).catch(() => null);
    if (device && !isControllableKind(device.kind)) {
      throw new IotError('IOT_NOT_CONTROLLABLE', 'Este dispositivo no se puede controlar');
    }

    return this.prefixed(entry.prefix, await entry.manager.setState(split.bareId, input));
  }

  /**
   * Delega el comisionado Matter (US-172) en el primer miembro que lo soporte y
   * prefija el id del nodo resultante para que case con `listDevices`. Solo se
   * expone `commission` si hay un miembro Matter.
   */
  private matterEntry(): CompositeEntry | undefined {
    return this.entries.find((e) => typeof e.manager.commission === 'function');
  }

  get commission(): ((code: string) => Promise<MatterCommissionResult>) | undefined {
    const entry = this.matterEntry();
    if (!entry) return undefined;
    return async (code: string) => {
      const result = await entry.manager.commission!(code);
      return { ...result, deviceId: `${entry.prefix}:${result.deviceId}` };
    };
  }
}
