import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { lookup } from 'node:dns/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EGRESS_POLICY,
  EgressBlockedError,
  assertHostAllowed,
  assertUrlAllowed,
  blockedReason,
  SAFE_FETCH_TIMEOUT_MS,
  extractHost,
  safeFetch,
} from '../../src/net/egress.js';

// El resolvedor DNS es un módulo del runtime: se mockea a nivel de módulo (ESM)
// para controlar a qué IP "resuelve" cada nombre en los tests.
vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
const mockLookup = vi.mocked(lookup);

const LENIENT = DEFAULT_EGRESS_POLICY; // solo metadata/link-local
const STRICT = { blockPrivate: true };

describe('blockedReason (clasificación de IPs)', () => {
  it('SIEMPRE bloquea la metadata de nube', () => {
    expect(blockedReason('169.254.169.254', LENIENT)).toMatch(/metadata/);
    expect(blockedReason('169.254.170.2', LENIENT)).toMatch(/metadata|link-local/);
    expect(blockedReason('169.254.169.254', STRICT)).toMatch(/metadata/);
    expect(blockedReason('fd00:ec2::254', LENIENT)).toMatch(/metadata/);
  });

  it('SIEMPRE bloquea link-local y la dirección no especificada', () => {
    expect(blockedReason('169.254.1.5', LENIENT)).toMatch(/link-local/);
    expect(blockedReason('fe80::1', LENIENT)).toMatch(/link-local/);
    expect(blockedReason('0.0.0.0', LENIENT)).toMatch(/no especificada/);
    expect(blockedReason('::', LENIENT)).toMatch(/no especificada/);
  });

  it('por defecto PERMITE loopback y rangos privados (destinos LAN legítimos)', () => {
    for (const ip of ['127.0.0.1', '::1', '10.0.0.5', '172.16.3.4', '192.168.1.1', 'fd12::1']) {
      expect(blockedReason(ip, LENIENT)).toBeNull();
    }
  });

  it('en modo estricto BLOQUEA loopback y privados', () => {
    expect(blockedReason('127.0.0.1', STRICT)).toMatch(/loopback/);
    expect(blockedReason('::1', STRICT)).toMatch(/loopback/);
    expect(blockedReason('10.0.0.5', STRICT)).toMatch(/privado/);
    expect(blockedReason('192.168.1.1', STRICT)).toMatch(/privado/);
    expect(blockedReason('172.20.0.1', STRICT)).toMatch(/privado/);
    expect(blockedReason('fd12::1', STRICT)).toMatch(/privado/);
  });

  it('permite IPs públicas en ambos modos', () => {
    expect(blockedReason('8.8.8.8', LENIENT)).toBeNull();
    expect(blockedReason('1.1.1.1', STRICT)).toBeNull();
    expect(blockedReason('2606:4700:4700::1111', STRICT)).toBeNull();
  });

  it('no se puede eludir con una IPv4-mapeada en notación IPv6', () => {
    expect(blockedReason('::ffff:169.254.169.254', LENIENT)).toMatch(/metadata/);
    expect(blockedReason('::ffff:127.0.0.1', STRICT)).toMatch(/loopback/);
    expect(blockedReason('::ffff:10.0.0.1', STRICT)).toMatch(/privado/);
  });

  it('172.16/12 se acota bien (172.15 y 172.32 NO son privados)', () => {
    expect(blockedReason('172.15.0.1', STRICT)).toBeNull();
    expect(blockedReason('172.32.0.1', STRICT)).toBeNull();
    expect(blockedReason('172.16.0.1', STRICT)).toMatch(/privado/);
    expect(blockedReason('172.31.255.255', STRICT)).toMatch(/privado/);
  });
});

describe('extractHost', () => {
  it('extrae el host de una URL con esquema', () => {
    expect(extractHost('http://192.168.1.1:8080/x')).toBe('192.168.1.1');
    expect(extractHost('https://pi.hole/admin')).toBe('pi.hole');
    expect(extractHost('mqtt://broker.local:1883')).toBe('broker.local');
  });

  it('quita el puerto de un host:puerto', () => {
    expect(extractHost('192.168.1.5:443')).toBe('192.168.1.5');
    expect(extractHost('router.local')).toBe('router.local');
  });

  it('maneja IPv6 entre corchetes', () => {
    expect(extractHost('[::1]:8080')).toBe('::1');
    expect(extractHost('http://[fe80::1]:80/')).toBe('fe80::1');
  });
});

describe('assertHostAllowed (literales, sin DNS)', () => {
  it('lanza EgressBlockedError con un literal de metadata', async () => {
    await expect(assertHostAllowed('169.254.169.254', LENIENT)).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });

  it('permite un literal de LAN por defecto', async () => {
    await expect(assertHostAllowed('192.168.1.10', LENIENT)).resolves.toBeUndefined();
  });

  it('bloquea un literal privado en modo estricto', async () => {
    await expect(assertHostAllowed('192.168.1.10', STRICT)).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });

  /**
   * Regresión (US-227): `new URL(...).hostname` devuelve las IPv6 **entre
   * corchetes**. Sin quitarlos, `isIP()` daba 0 y el host se trataba como nombre
   * DNS: con `allowUnresolvable` (el borde de configuración) el destino pasaba,
   * incluida la metadata IPv6 de nube.
   */
  it('reconoce IPv6 entre corchetes como literal, no como nombre DNS', async () => {
    const bracketed = [
      '[fd00:ec2::254]', // metadata IPv6 (IMDSv6)
      '[fe80::1]', // link-local
      '[::]', // no especificada
      '[::ffff:169.254.169.254]', // IPv4-mapeada (forma con puntos)
      '[::ffff:a9fe:a9fe]', // la MISMA, en la forma hexadecimal que normaliza Node
    ];
    for (const host of bracketed) {
      await expect(
        assertHostAllowed(host, LENIENT, { allowUnresolvable: true }),
      ).rejects.toBeInstanceOf(EgressBlockedError);
    }
    // Loopback y privadas: permitidas por la política LAN-friendly, bloqueadas en
    // estricta — también escritas en hexadecimal mapeado (`::ffff:7f00:1` = 127.0.0.1).
    for (const loopback of ['[::1]', '[::ffff:7f00:1]']) {
      await expect(assertHostAllowed(loopback, LENIENT)).resolves.toBeUndefined();
      await expect(
        assertHostAllowed(loopback, STRICT, { allowUnresolvable: true }),
      ).rejects.toBeInstanceOf(EgressBlockedError);
    }
  });
});

describe('assertHostAllowed (nombres DNS, lookup mockeado)', () => {
  beforeEach(() => mockLookup.mockReset());

  it('bloquea un nombre que RESUELVE a metadata', async () => {
    mockLookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }] as never);
    await expect(assertHostAllowed('evil.example', LENIENT)).rejects.toMatchObject({
      code: 'EGRESS_BLOCKED',
    });
  });

  it('permite un nombre que resuelve a una IP de LAN', async () => {
    mockLookup.mockResolvedValue([{ address: '192.168.1.20', family: 4 }] as never);
    await expect(assertHostAllowed('nas.local', LENIENT)).resolves.toBeUndefined();
  });

  it('bloquea si CUALQUIERA de las IPs resueltas está prohibida', async () => {
    mockLookup.mockResolvedValue([
      { address: '192.168.1.20', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ] as never);
    await expect(assertHostAllowed('rebind.example', LENIENT)).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });

  it('con allowUnresolvable NO bloquea un host que no resuelve (dispositivo offline)', async () => {
    mockLookup.mockResolvedValue([] as never); // resuelve a ninguna dirección
    await expect(
      assertHostAllowed('apagado.local', LENIENT, { allowUnresolvable: true }),
    ).resolves.toBeUndefined();
  });

  it('sin allowUnresolvable, un host que no resuelve SÍ es error (runtime)', async () => {
    mockLookup.mockResolvedValue([] as never);
    await expect(assertHostAllowed('apagado.local', LENIENT)).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });
});

describe('assertUrlAllowed', () => {
  it('rechaza esquemas que no son http(s)', async () => {
    await expect(assertUrlAllowed('file:///etc/passwd', LENIENT)).rejects.toMatchObject({
      code: 'EGRESS_BLOCKED',
    });
    await expect(assertUrlAllowed('gopher://x/', LENIENT)).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });

  it('rechaza credenciales embebidas en la URL', async () => {
    await expect(assertUrlAllowed('http://user:pass@8.8.8.8/', LENIENT)).rejects.toMatchObject({
      code: 'EGRESS_BLOCKED',
    });
  });

  it('rechaza una URL a metadata', async () => {
    await expect(
      assertUrlAllowed('http://169.254.169.254/latest/meta-data/', LENIENT),
    ).rejects.toBeInstanceOf(EgressBlockedError);
  });

  it('acepta una URL pública válida', async () => {
    await expect(assertUrlAllowed('https://8.8.8.8/', LENIENT)).resolves.toBeInstanceOf(URL);
  });
});

describe('safeFetch (redirects revalidados)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('bloquea un redirect (3xx) que reapunta a metadata', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 302,
      headers: new Headers({ location: 'http://169.254.169.254/' }),
    } as Response);
    await expect(safeFetch('https://8.8.8.8/', {}, LENIENT)).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1); // no llegó a pedir el destino malicioso
  });

  it('devuelve la respuesta cuando la URL y los redirects son válidos', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      headers: new Headers(),
    } as Response);
    const res = await safeFetch('https://8.8.8.8/', {}, LENIENT);
    expect(res.status).toBe(200);
  });
});

/**
 * US-230 (AUD3-31) — **estos tests atan la protección, no el mock.**
 *
 * Los de arriba mockean `globalThis.fetch` **entero**, así que la opción que DA la
 * protección (`redirect: 'manual'`) nunca se ejerce: en la prueba de mutación de la
 * 3ª auditoría, cambiarla a `'follow'` —una **regresión SSRF real**— atravesó los
 * 2.641 tests sin romper ninguno. Aquí se levanta un servidor HTTP efímero y se
 * comprueba el **efecto observable**: que el salto prohibido no se llega a pedir.
 *
 * Truco de la trampa: el destino del redirect es `0.0.0.0` (siempre bloqueada, en
 * cualquier política) y en Linux resuelve a **este mismo servidor**. Si alguien
 * quita `redirect: 'manual'`, `fetch` sigue el salto a ciegas y el servidor
 * registra `/trampa` — el test lo delata sin depender de ninguna red externa.
 */
describe('safeFetch contra un servidor HTTP real (US-230)', () => {
  let server: Server;
  let port = 0;
  let hits: string[] = [];
  let cabeceras: Record<string, string | string[] | undefined>[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = req.url ?? '/';
      hits.push(url);
      cabeceras.push(req.headers);
      if (url === '/post-a-get') {
        res.writeHead(302, { location: '/destino-get' });
      } else if (url === '/redirect-a-bloqueada') {
        res.writeHead(302, { location: `http://0.0.0.0:${port}/trampa` });
      } else if (url === '/redirect-a-metadata') {
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      } else if (url === '/redirect-sin-location') {
        res.writeHead(302);
      } else if (url === '/bucle') {
        res.writeHead(302, { location: '/bucle' });
      } else {
        res.writeHead(200, { 'content-type': 'text/plain' });
      }
      res.end('ok');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(() => {
    hits = [];
    cabeceras = [];
  });

  const url = (path: string) => `http://127.0.0.1:${port}${path}`;

  it('un POST que un 302 convierte en GET llega sin content-type ni content-length', async () => {
    await safeFetch(
      url('/post-a-get'),
      { method: 'POST', body: '{"a":1}', headers: { 'content-type': 'application/json' } },
      LENIENT,
    );
    expect(hits).toEqual(['/post-a-get', '/destino-get']);
    expect(cabeceras[0]?.['content-type']).toBe('application/json');
    expect(cabeceras[1]?.['content-type']).toBeUndefined();
    expect(cabeceras[1]?.['content-length']).toBeUndefined();
  });

  it('NO sigue un redirect real hacia una dirección prohibida (mata redirect:follow)', async () => {
    await expect(safeFetch(url('/redirect-a-bloqueada'), {}, LENIENT)).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
    // La prueba de verdad: el servidor recibió el primer salto y NUNCA la trampa.
    expect(hits).toContain('/redirect-a-bloqueada');
    expect(hits).not.toContain('/trampa');
  });

  it('NO sigue un redirect real hacia la metadata de nube', async () => {
    await expect(safeFetch(url('/redirect-a-metadata'), {}, LENIENT)).rejects.toMatchObject({
      code: 'EGRESS_BLOCKED',
    });
  });

  it('un 3xx sin Location se devuelve tal cual, sin seguir nada', async () => {
    const res = await safeFetch(url('/redirect-sin-location'), {}, LENIENT);
    expect(res.status).toBe(302);
    expect(hits).toEqual(['/redirect-sin-location']);
  });

  it('corta con error tras el máximo de saltos en vez de dar vueltas', async () => {
    await expect(safeFetch(url('/bucle'), {}, LENIENT)).rejects.toThrow(/demasiados redirects/);
    // MAX_REDIRECTS = 3 → 4 intentos (hop 0..3) y se rinde.
    expect(hits).toHaveLength(4);
  });

  it('una respuesta normal pasa y se devuelve al llamante', async () => {
    const res = await safeFetch(url('/ok'), {}, LENIENT);
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe('ok');
  });

  it('respeta la política: el mismo servidor loopback se bloquea en modo estricto', async () => {
    await expect(safeFetch(url('/ok'), {}, STRICT)).rejects.toBeInstanceOf(EgressBlockedError);
    expect(hits).toEqual([]); // ni se intentó la conexión
  });
});

describe('safeFetch: credenciales entre orígenes y tope de tiempo', () => {
  interface Recibida {
    method?: string;
    url?: string;
    headers: Record<string, string | string[] | undefined>;
    body: string;
  }
  let a: Server;
  let b: Server;
  let colgado: Server;
  let urlA = '';
  let urlB = '';
  let urlColgado = '';
  const enA: Recibida[] = [];
  const enB: Recibida[] = [];
  const sockets = new Set<Socket>();

  const escucha = async (s: Server): Promise<string> => {
    await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
  };
  const registra = (
    dest: Recibida[],
    respuesta: (r: Recibida) => [number, Record<string, string>],
  ) =>
    createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const r: Recibida = {
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString(),
        };
        dest.push(r);
        const [status, headers] = respuesta(r);
        res.writeHead(status, headers);
        res.end('ok');
      });
    });

  beforeAll(async () => {
    b = registra(enB, () => [200, {}]);
    urlB = await escucha(b);
    a = registra(enA, (r) => {
      if (r.url === '/otro-origen') return [302, { location: `${urlB}/destino` }];
      if (r.url === '/otro-origen-307') return [307, { location: `${urlB}/destino` }];
      if (r.url === '/mismo-301') return [301, { location: '/otra' }];
      if (r.url === '/mismo-303') return [303, { location: '/otra' }];
      if (r.url === '/mismo-origen') return [302, { location: '/otra' }];
      if (r.url === '/mismo-origen-307') return [307, { location: '/otra' }];
      return [200, {}];
    });
    urlA = await escucha(a);
    colgado = createServer(() => {
      /* acepta y nunca contesta */
    });
    colgado.on('connection', (s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    urlColgado = await escucha(colgado);
  });

  afterAll(async () => {
    for (const s of sockets) s.destroy();
    await Promise.all([a, b, colgado].map((s) => new Promise<void>((r) => s.close(() => r()))));
  });

  beforeEach(() => {
    enA.length = 0;
    enB.length = 0;
  });

  afterEach(() => vi.restoreAllMocks());

  const conCredenciales = (): RequestInit => ({
    method: 'POST',
    headers: {
      authorization: 'Basic x',
      cookie: 's=1',
      'x-api-key': 'k',
      'proxy-authorization': 'p',
      'x-otra': 'queda',
    },
    body: 'secreto',
  });

  for (const ruta of ['/otro-origen']) {
    it(`no reenvía credenciales ni cuerpo a otro origen (${ruta})`, async () => {
      await safeFetch(`${urlA}${ruta}`, conCredenciales(), LENIENT);
      expect(enA[0]?.body).toBe('secreto'); // el primer salto sí las lleva
      expect(enB).toHaveLength(1);
      const r = enB[0]!;
      expect(r.method).toBe('GET');
      expect(r.body).toBe('');
      for (const h of ['authorization', 'cookie', 'x-api-key', 'proxy-authorization']) {
        expect(r.headers[h]).toBeUndefined();
      }
      expect(r.headers['x-otra']).toBe('queda');
    });
  }

  it('no hereda el dispatcher en un salto a otro origen', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        status: 302,
        headers: new Headers({ location: 'http://8.8.4.4/x' }),
      } as Response)
      .mockResolvedValueOnce({ status: 200, headers: new Headers() } as Response);
    const dispatcher = { marca: 'lan' };
    await safeFetch('http://8.8.8.8/', { dispatcher } as unknown as RequestInit, LENIENT);
    const [primera, segunda] = fetchSpy.mock.calls.map((c) => c[1] as Record<string, unknown>);
    expect(primera?.dispatcher).toBe(dispatcher);
    expect(segunda).not.toHaveProperty('dispatcher');
  });

  it('conserva las cabeceras en una redirección del mismo origen', async () => {
    await safeFetch(`${urlA}/mismo-origen`, conCredenciales(), LENIENT);
    expect(enA.map((r) => r.url)).toEqual(['/mismo-origen', '/otra']);
    expect(enA[1]?.headers.authorization).toBe('Basic x');
    expect(enA[1]?.headers['x-api-key']).toBe('k');
    expect(enA[1]?.method).toBe('GET'); // 302 → GET sin cuerpo
    expect(enA[1]?.body).toBe('');
  });

  it('DELETE con 301 al mismo origen llega como DELETE', async () => {
    await safeFetch(`${urlA}/mismo-301`, { method: 'DELETE' }, LENIENT);
    expect(enA.map((r) => r.method)).toEqual(['DELETE', 'DELETE']);
  });

  it('PUT con cuerpo y 302 al mismo origen llega como PUT con el mismo cuerpo', async () => {
    await safeFetch(`${urlA}/mismo-origen`, { method: 'PUT', body: 'datos' }, LENIENT);
    expect(enA[1]?.method).toBe('PUT');
    expect(enA[1]?.body).toBe('datos');
  });

  it('PUT con 303 al mismo origen llega como GET sin cuerpo', async () => {
    await safeFetch(`${urlA}/mismo-303`, { method: 'PUT', body: 'datos' }, LENIENT);
    expect(enA[1]?.method).toBe('GET');
    expect(enA[1]?.body).toBe('');
  });

  it('PUT con 307 a OTRO origen se rechaza y el destino no recibe nada', async () => {
    await expect(
      safeFetch(`${urlA}/otro-origen-307`, { method: 'PUT', body: 'datos' }, LENIENT),
    ).rejects.toMatchObject({ code: 'EGRESS_BLOCKED', message: /escritura a otro origen/ });
    expect(enA).toHaveLength(1);
    expect(enB).toHaveLength(0);
  });

  it('un 307 del mismo origen conserva método y cuerpo', async () => {
    await safeFetch(`${urlA}/mismo-origen-307`, conCredenciales(), LENIENT);
    expect(enA[1]?.method).toBe('POST');
    expect(enA[1]?.body).toBe('secreto');
    expect(enA[1]?.headers.authorization).toBe('Basic x');
  });

  it('corta una petición que no responde (signal propio de 200 ms)', async () => {
    const t0 = Date.now();
    await expect(
      safeFetch(urlColgado, { signal: AbortSignal.timeout(200) }, LENIENT),
    ).rejects.toThrow();
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('sin signal usa SAFE_FETCH_TIMEOUT_MS y aborta al llegar al tope', async () => {
    expect(SAFE_FETCH_TIMEOUT_MS).toBe(10_000);
    const real = AbortSignal.timeout.bind(AbortSignal);
    const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => real(150));
    await expect(safeFetch(urlColgado, {}, LENIENT)).rejects.toThrow();
    expect(spy).toHaveBeenCalledWith(SAFE_FETCH_TIMEOUT_MS);
  });

  it('respeta el signal del llamante: no lo pisa con el del tope', async () => {
    const spy = vi.spyOn(AbortSignal, 'timeout');
    const ctl = new AbortController();
    const motivo = new Error('cancelado por el llamante');
    setTimeout(() => ctl.abort(motivo), 50);
    await expect(safeFetch(urlColgado, { signal: ctl.signal }, LENIENT)).rejects.toBe(motivo);
    expect(spy).not.toHaveBeenCalled();
  });
});
