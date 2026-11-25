import { describe, expect, it, vi } from 'vitest';

const sock = vi.hoisted(() => ({
  once: vi.fn(),
  removeListener: vi.fn(),
  bind: vi.fn((_port: number, cb: () => void) => cb()),
  addMembership: vi.fn(),
  setMulticastTTL: vi.fn(),
  setTTL: vi.fn(),
  setMulticastInterface: vi.fn(),
  on: vi.fn(),
  close: vi.fn(),
}));
vi.mock('node:dgram', () => ({ createSocket: () => sock, default: { createSocket: () => sock } }));

import { DgramResponderSocket } from '../../src/discovery/mdns-socket.js';

describe('DgramResponderSocket', () => {
  it('usa IP TTL 255 (RFC 6762 §11) en multicast y unicast', async () => {
    await new DgramResponderSocket().start(() => {});
    expect(sock.setMulticastTTL).toHaveBeenCalledWith(255);
    expect(sock.setTTL).toHaveBeenCalledWith(255);
  });
});
