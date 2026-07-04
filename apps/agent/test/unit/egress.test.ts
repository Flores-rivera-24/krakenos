import { lookup } from 'node:dns/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EGRESS_POLICY,
  EgressBlockedError,
  assertHostAllowed,
  assertUrlAllowed,
  blockedReason,
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
    await expect(assertUrlAllowed('http://169.254.169.254/latest/meta-data/', LENIENT)).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
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
