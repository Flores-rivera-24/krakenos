import os from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { buildSetupUrl, firstLanIpv4 } from '../../src/modules/setup/setup-url.js';

type Nifs = ReturnType<typeof os.networkInterfaces>;

describe('firstLanIpv4 (US-105)', () => {
  it('devuelve la primera IPv4 no interna (LAN)', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      eth0: [
        { family: 'IPv6', internal: false, address: 'fe80::1' },
        { family: 'IPv4', internal: false, address: '192.168.1.42' },
      ],
    } as unknown as Nifs);
    expect(firstLanIpv4()).toBe('192.168.1.42');
  });

  it('cae a localhost si solo hay interfaces internas', () => {
    vi.spyOn(os, 'networkInterfaces').mockReturnValue({
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    } as unknown as Nifs);
    expect(firstLanIpv4()).toBe('localhost');
  });
});

describe('setup URL (US-105)', () => {
  it('incrusta el token en el query y respeta el esquema/host/puerto', () => {
    expect(buildSetupUrl({ scheme: 'http', host: '192.168.1.50', port: 3001, token: 'abc123' })).toBe(
      'http://192.168.1.50:3001/setup?token=abc123',
    );
  });

  it('escapa caracteres especiales del token', () => {
    expect(buildSetupUrl({ scheme: 'https', host: 'krakenos.local', port: 443, token: 'a/b+c' })).toBe(
      'https://krakenos.local:443/setup?token=a%2Fb%2Bc',
    );
  });
});
