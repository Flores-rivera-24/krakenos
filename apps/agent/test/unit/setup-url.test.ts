import type os from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  buildSetupUrl,
  firstLanIpv4,
  isLoopbackHost,
  isPrivateIpv4,
  resolveSetupUrl,
} from '../../src/modules/setup/setup-url.js';

type Nifs = ReturnType<typeof os.networkInterfaces>;

const lo = { family: 'IPv4', internal: true, address: '127.0.0.1' };
const nifs = (o: Record<string, object[]>) => o as unknown as Nifs;

describe('firstLanIpv4', () => {
  it('devuelve la primera IPv4 privada de la LAN', () => {
    expect(
      firstLanIpv4(
        nifs({
          lo: [lo],
          eth0: [
            { family: 'IPv6', internal: false, address: 'fe80::1' },
            { family: 'IPv4', internal: false, address: '192.168.1.42' },
          ],
        }),
      ),
    ).toBe('192.168.1.42');
  });

  it('una 100.x de Tailscale o una IP pública delante no ganan a la privada', () => {
    expect(
      firstLanIpv4(
        nifs({
          tailscale0: [{ family: 'IPv4', internal: false, address: '100.101.102.103' }],
          wan0: [{ family: 'IPv4', internal: false, address: '8.8.4.4' }],
          eth0: [{ family: 'IPv4', internal: false, address: '10.0.0.7' }],
        }),
      ),
    ).toBe('10.0.0.7');
  });

  it('prefiere 10.x/192.168.x a la 172.16/12 (NAT de WSL/Docker) aunque esta vaya antes', () => {
    expect(
      firstLanIpv4(
        nifs({
          eth0: [{ family: 'IPv4', internal: false, address: '172.24.5.2' }],
          wlan0: [{ family: 'IPv4', internal: false, address: '192.168.0.9' }],
        }),
      ),
    ).toBe('192.168.0.9');
    expect(
      firstLanIpv4(nifs({ eth0: [{ family: 'IPv4', internal: false, address: '172.24.5.2' }] })),
    ).toBe('172.24.5.2');
  });

  it('salta las interfaces virtuales de contenedores', () => {
    expect(
      firstLanIpv4(
        nifs({
          docker0: [{ family: 'IPv4', internal: false, address: '192.168.99.1' }],
          eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.5' }],
        }),
      ),
    ).toBe('192.168.1.5');
  });

  it('cae a localhost si no hay ninguna privada (solo loopback, 100.x o pública)', () => {
    expect(firstLanIpv4(nifs({ lo: [lo] }))).toBe('localhost');
    expect(
      firstLanIpv4(
        nifs({
          ts: [{ family: 'IPv4', internal: false, address: '100.64.0.1' }],
          wan: [{ family: 'IPv4', internal: false, address: '203.0.113.9' }],
        }),
      ),
    ).toBe('localhost');
  });

  it('ignora IPv6', () => {
    expect(
      firstLanIpv4(nifs({ eth0: [{ family: 'IPv6', internal: false, address: '192.168.1.1' }] })),
    ).toBe('localhost');
  });

  it('172.15.x y 172.32.x no son privadas', () => {
    expect(isPrivateIpv4('172.15.0.1')).toBe(false);
    expect(isPrivateIpv4('172.32.0.1')).toBe(false);
    expect(isPrivateIpv4('172.31.0.1')).toBe(true);
  });
});

describe('resolveSetupUrl', () => {
  const ifaces = nifs({
    eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.42' }],
  });
  const base = { https: false, port: 3001, token: 'tok', interfaces: ifaces };

  it('usa el origen fijado de la instalación (--tls local)', () => {
    expect(resolveSetupUrl({ ...base, webOrigin: 'https://casa.local:8443' })).toBe(
      'https://casa.local:8443/setup?token=tok',
    );
  });

  it('descarta ruta y barra final del origen', () => {
    expect(resolveSetupUrl({ ...base, webOrigin: 'https://casa.ts.net/algo/' })).toBe(
      'https://casa.ts.net/setup?token=tok',
    );
  });

  it('un origen de loopback (vite en dev) o ilegible no cuenta: cae a la IP privada', () => {
    for (const o of ['http://localhost:5173', 'http://127.0.0.1:5173', 'basura', 'ftp://x', '']) {
      expect(resolveSetupUrl({ ...base, webOrigin: o })).toBe(
        'http://192.168.1.42:3001/setup?token=tok',
      );
    }
  });

  it('sin WEB_ORIGIN usa la IP privada y el esquema según https', () => {
    expect(resolveSetupUrl({ ...base, webOrigin: undefined, https: true })).toBe(
      'https://192.168.1.42:3001/setup?token=tok',
    );
  });

  it('sin ninguna privada acaba en localhost', () => {
    expect(resolveSetupUrl({ ...base, webOrigin: undefined, interfaces: nifs({ lo: [lo] }) })).toBe(
      'http://localhost:3001/setup?token=tok',
    );
  });
});

describe('resolveSetupUrl con el HOST de escucha', () => {
  const ifaces = nifs({
    eth0: [{ family: 'IPv4', internal: false, address: '192.168.1.42' }],
  });
  const base = { https: false, port: 3001, token: 'tok', interfaces: ifaces };

  it('con HOST en loopback y sin WEB_ORIGIN, la URL usa 127.0.0.1', () => {
    for (const host of ['127.0.0.1', '127.1.2.3', '::1', '[::1]', 'localhost', 'LOCALHOST']) {
      expect(resolveSetupUrl({ ...base, webOrigin: undefined, host })).toBe(
        'http://127.0.0.1:3001/setup?token=tok',
      );
    }
  });

  it('con HOST en loopback, un WEB_ORIGIN fijado sigue mandando', () => {
    expect(
      resolveSetupUrl({ ...base, webOrigin: 'https://casa.local:8443', host: '127.0.0.1' }),
    ).toBe('https://casa.local:8443/setup?token=tok');
  });

  it('con 0.0.0.0 o una IP de la LAN, igual que sin HOST', () => {
    for (const host of ['0.0.0.0', '192.168.1.42', '::']) {
      expect(resolveSetupUrl({ ...base, webOrigin: undefined, host })).toBe(
        'http://192.168.1.42:3001/setup?token=tok',
      );
    }
  });
});

describe('isLoopbackHost', () => {
  it('reconoce loopback y rechaza lo demás', () => {
    for (const h of ['127.0.0.1', '127.9.9.9', '::1', '[::1]', 'localhost'])
      expect(isLoopbackHost(h)).toBe(true);
    for (const h of ['0.0.0.0', '::', '192.168.1.5', '1127.0.0.1', 'casa.local', ''])
      expect(isLoopbackHost(h)).toBe(false);
  });
});

describe('setup URL', () => {
  it('incrusta el token en el query y respeta el esquema/host/puerto', () => {
    expect(
      buildSetupUrl({ scheme: 'http', host: '192.168.1.50', port: 3001, token: 'abc123' }),
    ).toBe('http://192.168.1.50:3001/setup?token=abc123');
  });

  it('escapa caracteres especiales del token', () => {
    expect(
      buildSetupUrl({ scheme: 'https', host: 'krakenos.local', port: 443, token: 'a/b+c' }),
    ).toBe('https://krakenos.local:443/setup?token=a%2Fb%2Bc');
  });
});
