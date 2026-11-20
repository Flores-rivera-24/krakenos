/**
 * Arranque del respondedor mDNS según `MDNS_RESPONDER` (US-283) y estado para la API.
 * `auto` = solo en Windows (en Linux contesta Avahi); `on` fuerza; `off` apaga.
 * Mientras corre, cada minuto compara las IPv4 privadas: si cambian (red que llega tarde,
 * DHCP, otro Wi-Fi, suspensión) se une de nuevo al grupo, y si estaba caído lo reintenta.
 */
import type { MdnsResponderStatus } from '@krakenos/types';
import { MdnsResponder, type MdnsResponderDeps } from './mdns-responder.js';

export type MdnsMode = 'auto' | 'on' | 'off';

export interface MdnsHandle {
  status(): MdnsResponderStatus;
  stop(): Promise<void>;
}

const RECHECK_MS = 60_000;

/** Programa `fn` cada `ms` y devuelve cómo cancelarlo; el real no mantiene vivo el proceso. */
export type Every = (fn: () => void | Promise<void>, ms: number) => () => void;

const realEvery: Every = (fn, ms) => {
  const timer = setInterval(() => void fn(), ms);
  timer.unref();
  return () => clearInterval(timer);
};

export async function startMdnsResponder(
  opts: {
    mode: MdnsMode;
    platform: NodeJS.Platform;
    port: number;
    every?: Every;
  } & MdnsResponderDeps,
): Promise<MdnsHandle> {
  const { mode, platform, port, every = realEvery, ...deps } = opts;
  const active = mode === 'on' || (mode === 'auto' && platform === 'win32');
  if (!active)
    return {
      status: () => ({ state: 'off', reason: null, code: null, address: null }),
      stop: async () => {},
    };
  const responder = new MdnsResponder(deps);
  await responder.start();
  const nicsKey = () =>
    Object.values(deps.interfaces())
      .flatMap((l) => l ?? [])
      .filter((i) => !i.internal && i.family === 'IPv4')
      .map((i) => i.address)
      .sort()
      .join(',');
  let lastKey = nicsKey();
  let busy = false;
  const cancel = every(async () => {
    if (busy) return;
    busy = true;
    try {
      const key = nicsKey();
      const changed = key !== lastKey;
      if (changed) {
        lastKey = key;
        deps.log.warn(
          `mDNS: cambió la red (${key || 'sin interfaces'}), se reajusta el respondedor`,
        );
      }
      if (responder.current() !== 'running') await responder.restart();
      else if (changed) responder.refresh();
    } catch {
      // un fallo de este ciclo se reintenta en el siguiente
    } finally {
      busy = false;
    }
  }, RECHECK_MS);
  return {
    status: () => {
      const r = responder.current();
      return r === 'running'
        ? {
            state: 'running',
            reason: null,
            code: null,
            address: `${[deps.nombre].flat()[0]}.local:${port}`,
          }
        : { state: 'unavailable', reason: r.unavailable, code: r.code, address: null };
    },
    stop: async () => {
      cancel();
      if (responder.current() === 'running') await responder.stop();
    },
  };
}
