import { IotError } from './mock.iot.js';

/**
 * Timeout por acción en la orquestación IoT (US-203 / AUD-07). La capa de
 * transporte es heterogénea (Kasa trae timeout propio, el `fetch` de Hue no):
 * un bridge TCP half-open colgaría `scenes.run`, `runGroupAction` o el barrido
 * de horarios indefinidamente, dejando sin disparar el resto del lote. El
 * cuelgue cuenta como fallo de esa acción y la orquestación sigue.
 */
export const IOT_ACTION_TIMEOUT_MS = 10_000;

/**
 * Ejecuta `action` con un tope de `ms`; si vence, rechaza con
 * `IotError('IOT_TIMEOUT')`. La promesa subyacente no se puede cancelar: si
 * termina tarde, su resultado (o su rechazo) se descarta en silencio.
 */
export async function withActionTimeout<T>(
  action: () => Promise<T>,
  ms: number = IOT_ACTION_TIMEOUT_MS,
): Promise<T> {
  const promise = action();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      promise.catch(() => undefined); // el resultado tardío ya no importa
      reject(new IotError('IOT_TIMEOUT', 'El dispositivo no respondió a tiempo'));
    }, ms);
    timer.unref();
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
