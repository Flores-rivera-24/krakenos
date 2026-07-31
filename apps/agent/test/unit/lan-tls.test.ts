import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer, type Server } from 'node:https';
import type { AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  _resetCacheLan,
  cerrarDispatcherLan,
  esHostDeLan,
  initConTlsDeLan,
} from '../../src/net/lan-tls.js';
import { safeFetch } from '../../src/net/egress.js';

/**
 * US-259. La excepción de TLS para el bridge Hue solo vale algo si está **acotada**,
 * así que lo que hay que probar no es que funcione con el certificado autofirmado
 * —eso es la parte fácil— sino que **no** se aplica donde no toca.
 *
 * Se levanta un servidor HTTPS real con un certificado autofirmado y se comprueba
 * el efecto observable en los dos sentidos, siguiendo el patrón de `egress.test.ts`
 * (mockear el transporte no probaría nada: la verificación TLS ocurre por debajo).
 */

let dir: string;
let server: Server;
let port = 0;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'krakenos-tls-'));
  const key = join(dir, 'k.pem');
  const cert = join(dir, 'c.pem');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', key, '-out', cert,
    '-days', '1', '-nodes', '-subj', '/CN=localhost',
  ]);

  server = createHttpsServer(
    { key: readFileSync(key), cert: readFileSync(cert) },
    (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"data":[]}');
    },
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await cerrarDispatcherLan();
});

afterEach(() => _resetCacheLan());

describe('esHostDeLan (US-259)', () => {
  it('reconoce loopback y los rangos privados', async () => {
    expect(await esHostDeLan('https://127.0.0.1:443/x')).toBe(true);
    expect(await esHostDeLan('https://192.168.1.50')).toBe(true);
    expect(await esHostDeLan('https://10.0.0.5')).toBe(true);
    expect(await esHostDeLan('https://172.16.0.1')).toBe(true);
  });

  it('NO reconoce una IP pública ni la metadata de nube', async () => {
    expect(await esHostDeLan('https://1.1.1.1')).toBe(false);
    expect(await esHostDeLan('https://8.8.8.8')).toBe(false);
    // La metadata está bloqueada por la política por defecto: no es «LAN».
    expect(await esHostDeLan('http://169.254.169.254/latest/')).toBe(false);
  });

  it('un host que no resuelve no se lleva la excepción', async () => {
    expect(await esHostDeLan('https://no-existe.invalid')).toBe(false);
  });
});

describe('initConTlsDeLan: la excepción se aplica solo a la LAN', () => {
  it('a una IP de LAN le añade el dispatcher', async () => {
    const init = await initConTlsDeLan('https://192.168.1.50/clip/v2', { method: 'GET' });
    expect(init).toHaveProperty('dispatcher');
    expect((init as { method?: string }).method).toBe('GET'); // no pisa lo que ya había
  });

  it('a un host público lo deja INTACTO (no se baja la guardia contra internet)', async () => {
    const original = { method: 'GET' };
    const init = await initConTlsDeLan('https://api.telegram.org/bot/x', original);
    expect(init).not.toHaveProperty('dispatcher');
    expect(init).toEqual(original);
  });
});

describe('efecto observable contra un HTTPS autofirmado real', () => {
  const url = () => `https://127.0.0.1:${port}/clip/v2/resource`;

  it('sin la excepción, la petición FALLA por el certificado', async () => {
    // Si esto dejara de fallar, el test de abajo no probaría nada.
    await expect(safeFetch(url(), {})).rejects.toMatchObject({
      cause: expect.objectContaining({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }),
    });
  });

  it('con la excepción de LAN, la petición LLEGA', async () => {
    const res = await safeFetch(url(), await initConTlsDeLan(url(), {}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });
});
