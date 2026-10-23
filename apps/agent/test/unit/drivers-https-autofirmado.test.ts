import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer as createHttpsServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AsusClient } from '../../src/drivers/asus.transport.js';
import { RestMikrotikTransport } from '../../src/drivers/mikrotik.transport.js';
import { OmadaClient } from '../../src/drivers/omada.transport.js';
import { UnifiClient } from '../../src/drivers/unifi.transport.js';
import { _resetCacheLan, cerrarDispatcherLan } from '../../src/net/lan-tls.js';

/**
 * Las guías de UniFi, Omada, MikroTik y ASUS dicen que el agente acepta el
 * certificado autofirmado del equipo (conexión LAN). Se comprueba el efecto
 * observable: un HTTPS real con certificado autofirmado, usando el `fetch` POR
 * DEFECTO de cada transporte (sin inyectar uno).
 */

let server: Server;
let base = '';

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'krakenos-drv-tls-'));
  const key = join(dir, 'k.pem');
  const cert = join(dir, 'c.pem');
  execFileSync('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-keyout',
    key,
    '-out',
    cert,
    '-days',
    '1',
    '-nodes',
    '-subj',
    '/CN=localhost',
  ]);
  server = createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end('{"errorCode":0,"result":{}}');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
  _resetCacheLan();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await cerrarDispatcherLan();
});

describe('los transportes HTTPS de LAN aceptan el certificado autofirmado', () => {
  it('UniFi', async () => {
    const c = new UnifiClient({ url: base, username: 'u', password: 'p' });
    await expect(c.login()).resolves.toBeUndefined();
  });

  it('Omada', async () => {
    const c = new OmadaClient({ url: base, username: 'u', password: 'p' });
    await expect(c.login()).resolves.toBeUndefined();
  });

  it('MikroTik (REST)', async () => {
    const t = new RestMikrotikTransport({ baseUrl: base, username: 'u', password: 'p' });
    await expect(t.add('/ip/firewall/filter', {})).resolves.toBeUndefined();
  });

  it('ASUS', async () => {
    const c = new AsusClient({ baseUrl: base, username: 'u', password: 'p' });
    await expect(c.get('uptime()')).resolves.toContain('errorCode');
  });
});
