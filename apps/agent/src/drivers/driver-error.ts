import type { HardwareDriver } from '@krakenos/types';

/**
 * Fallo del driver de hardware al hablar con el dispositivo real (router caído,
 * timeout, credenciales inválidas, comando que devuelve error). Lleva
 * `statusCode 502` para que Fastify responda **502 Bad Gateway** con un `code`
 * estable en vez de un 500 genérico: el front (US-93/US-96) distingue así un
 * fallo del hardware aguas arriba de un bug del agente, y revierte/avisa limpio.
 */
export class DriverUnavailableError extends Error {
  readonly statusCode = 502;
  readonly code = 'DRIVER_UNAVAILABLE';

  constructor(method: string, options?: { cause?: unknown }) {
    super(`El driver de hardware falló al ejecutar "${method}"`, options);
    this.name = 'DriverUnavailableError';
  }
}

/**
 * Envuelve un `HardwareDriver` para traducir **cualquier excepción** de sus
 * métodos (síncrona o rechazo de promesa) en un `DriverUnavailableError`
 * tipado. Un único punto de traducción en vez de un try/catch por ruta: las
 * rutas dejan que el error suba y Fastify emite el 502; los caminos de fondo
 * (`scanCycle`/`sampleCycle`) lo capturan igual que cualquier otro error. Los
 * valores no-función (p. ej. `kind`) pasan sin tocar (US-98).
 */
export function wrapDriverErrors(driver: HardwareDriver): HardwareDriver {
  return new Proxy(driver, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') return value;
      const method = String(prop);
      return (...args: unknown[]): unknown => {
        try {
          const result = (value as (...a: unknown[]) => unknown).apply(target, args);
          if (result instanceof Promise) {
            return result.catch((err: unknown) => {
              throw new DriverUnavailableError(method, { cause: err });
            });
          }
          return result;
        } catch (err) {
          throw new DriverUnavailableError(method, { cause: err });
        }
      };
    },
  });
}
