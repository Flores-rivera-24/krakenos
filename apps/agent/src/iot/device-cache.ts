import { IOT_ACTION_TIMEOUT_MS, withActionTimeout } from './action-timeout.js';
import type { ReportsListFailures } from './composite.iot.js';
import type { IotDevice, IotManager, UpdateIotStateRequest } from '@krakenos/types';

/** Ventana de validez de la instantánea de dispositivos. */
export const DEFAULT_DEVICE_CACHE_TTL_MS = 5_000;

export interface DeviceCacheOptions {
  /** Validez de la instantánea en ms (por defecto {@link DEFAULT_DEVICE_CACHE_TTL_MS}). */
  ttlMs?: number;
  /** Reloj inyectable (ms); por defecto `Date.now`. */
  now?: () => number;
  /** Tope de una lectura en ms (por defecto {@link IOT_ACTION_TIMEOUT_MS}): un transporte colgado no congela la caché. */
  listTimeoutMs?: number;
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
 * fantasma al expirar el TTL). Un fallo de `listDevices` no se cachea, y una
 * lectura que tarda más de `listTimeoutMs` (10 s) cuenta como fallo, para que un
 * transporte colgado no congele el barrido. Un resultado **parcial** (un backend
 * del composite caído) sí se cachea 5 s, y `listFailures()` pasa tal cual los
 * fallos de esa misma lectura.
 *
 * Alcance deliberado: es una vista de **lectura** para consumidores de fondo. No
 * expone `stop()` ni `commission()` — el ciclo de vida del manager lo gobierna su
 * `ManagerHolder` (`runtime.stopAll()`), y las rutas siguen recibiendo el handle
 * recargable directo, sin caché.
 */
export function withDeviceCache(
  iot: IotManager,
  opts: DeviceCacheOptions = {},
): IotManager & Partial<ReportsListFailures> {
  const ttlMs = opts.ttlMs ?? DEFAULT_DEVICE_CACHE_TTL_MS;
  const now = opts.now ?? Date.now;
  const listTimeoutMs = opts.listTimeoutMs ?? IOT_ACTION_TIMEOUT_MS;

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
      inFlight = withActionTimeout(() => iot.listDevices(), listTimeoutMs)
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

    /** Fallos parciales de la última lectura real (solo si el manager los reporta). */
    listFailures: () => (iot as Partial<ReportsListFailures>).listFailures?.() ?? [],

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
