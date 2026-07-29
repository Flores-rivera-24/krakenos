import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';

/** Ventana de validez de la instantánea de dispositivos. */
export const DEFAULT_DEVICE_CACHE_TTL_MS = 5_000;

export interface DeviceCacheOptions {
  /** Validez de la instantánea en ms (por defecto {@link DEFAULT_DEVICE_CACHE_TTL_MS}). */
  ttlMs?: number;
  /** Reloj inyectable (ms); por defecto `Date.now`. */
  now?: () => number;
}

/**
 * Vista cacheada de un `IotManager` para los **barridos de fondo** (US-229 /
 * AUD3-18).
 *
 * `listDevices()` no tenía caché y lo llamaban cinco consumidores con sus propios
 * temporizadores: con la alarma armada eran **~71 sondeos por minuto** al
 * hardware IoT (la alarma sola aportaba 60: su barrido de 1 s hacía el fail-safe
 * en cada ciclo). Contra un bridge Hue o un broker MQTT eso es tráfico
 * constante e inútil, porque los cinco quieren exactamente la misma lista.
 *
 * Dos garantías:
 * - **TTL corto**: una instantánea se reutiliza durante `ttlMs`. Con 5 s, ningún
 *   consumidor ve datos más viejos que su propio intervalo de sondeo.
 * - **Single-flight**: varias llamadas concurrentes comparten la petición en
 *   vuelo en vez de lanzar N (mismo patrón que la caché del heatmap).
 *
 * `setState` **invalida** la instantánea: tras encender una luz, el siguiente
 * barrido debe verla encendida (si no, el `IotWatcher` publicaría una transición
 * fantasma al expirar el TTL). Un fallo de `listDevices` no se cachea.
 *
 * Alcance deliberado: es una vista de **lectura** para consumidores de fondo. No
 * expone `stop()` ni `commission()` — el ciclo de vida del manager lo gobierna su
 * `ManagerHolder` (`runtime.stopAll()`), y las rutas siguen recibiendo el handle
 * recargable directo, sin caché.
 */
export function withDeviceCache(iot: IotManager, opts: DeviceCacheOptions = {}): IotManager {
  const ttlMs = opts.ttlMs ?? DEFAULT_DEVICE_CACHE_TTL_MS;
  const now = opts.now ?? Date.now;

  let snapshot: IotDevice[] | null = null;
  let takenAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<IotDevice[]> | null = null;

  function invalidate(): void {
    snapshot = null;
    takenAt = Number.NEGATIVE_INFINITY;
  }

  return {
    async listDevices(): Promise<IotDevice[]> {
      if (snapshot && now() - takenAt < ttlMs) return snapshot;
      // Ya hay una lectura en curso: se comparte en vez de abrir otra.
      if (inFlight) return inFlight;
      inFlight = iot
        .listDevices()
        .then((devices) => {
          snapshot = devices;
          takenAt = now();
          return devices;
        })
        .finally(() => {
          inFlight = null;
        });
      return inFlight;
    },

    /** Sin caché: lo usan caminos puntuales que quieren el estado real de un aparato. */
    getDevice(id: string): Promise<IotDevice | null> {
      return iot.getDevice(id);
    },

    async setState(id: string, input: UpdateIotStateRequest): Promise<IotDevice> {
      const device = await iot.setState(id, input);
      invalidate();
      return device;
    },
  };
}
