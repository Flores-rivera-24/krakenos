/**
 * Arranque del respondedor mDNS según `MDNS_RESPONDER` (US-283) y estado para la API.
 * `auto` = solo en Windows (en Linux contesta Avahi); `on` fuerza; `off` apaga.
 */
import type { MdnsResponderStatus } from '@krakenos/types';
import { MdnsResponder, type MdnsResponderDeps } from './mdns-responder.js';

export type MdnsMode = 'auto' | 'on' | 'off';

export interface MdnsHandle {
  status(): MdnsResponderStatus;
  stop(): Promise<void>;
}

export async function startMdnsResponder(
  opts: { mode: MdnsMode; platform: NodeJS.Platform } & MdnsResponderDeps,
): Promise<MdnsHandle> {
  const { mode, platform, ...deps } = opts;
  const active = mode === 'on' || (mode === 'auto' && platform === 'win32');
  if (!active) return { status: () => ({ state: 'off', reason: null }), stop: async () => {} };
  const responder = new MdnsResponder(deps);
  const result = await responder.start();
  const status: MdnsResponderStatus =
    result === 'running'
      ? { state: 'running', reason: null }
      : { state: 'unavailable', reason: result.unavailable };
  return {
    status: () => status,
    stop: () => (status.state === 'running' ? responder.stop() : Promise.resolve()),
  };
}
