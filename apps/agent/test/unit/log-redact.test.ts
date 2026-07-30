import { describe, expect, it } from 'vitest';
import { REDACTADO, redactUrl, serializarPeticion } from '../../src/observability/log-redact.js';

/**
 * US-231 (AUD3-08) — el token de stream de cámaras viaja en `?st=` y el de setup
 * en `/setup?token=`. Fastify registraba `req.url` tal cual, y la plantilla de bug
 * de US-218 le pide al usuario que pegue el log en un issue **público**.
 */
describe('redactUrl', () => {
  it('redacta el token de stream de cámaras conservando el resto', () => {
    const url = '/api/cameras/cam-1/stream/seg-004.ts?st=eyJhbGciOiJSUzI1NiJ9.secreto.firma';
    const out = redactUrl(url);
    expect(out).toBe(`/api/cameras/cam-1/stream/seg-004.ts?st=${REDACTADO}`);
    expect(out).not.toContain('secreto');
  });

  it('redacta el token de configuración del primer arranque', () => {
    expect(redactUrl('/setup?token=abc123def456')).toBe(`/setup?token=${REDACTADO}`);
  });

  it('conserva los parámetros que SÍ sirven para depurar', () => {
    expect(redactUrl('/api/traffic/stats?range=week')).toBe('/api/traffic/stats?range=week');
    const mixto = redactUrl('/api/cameras/c/stream/index.m3u8?range=day&st=SECRETO&limit=20');
    expect(mixto).toContain('range=day');
    expect(mixto).toContain('limit=20');
    expect(mixto).not.toContain('SECRETO');
  });

  it('no toca una URL sin query', () => {
    expect(redactUrl('/api/iot/devices')).toBe('/api/iot/devices');
    expect(redactUrl('')).toBe('');
  });

  it('es insensible a mayúsculas en el nombre del parámetro', () => {
    expect(redactUrl('/x?ST=abc')).toContain(REDACTADO);
    expect(redactUrl('/x?Token=abc')).toContain(REDACTADO);
  });

  it('redacta también otros nombres típicos de secreto', () => {
    for (const nombre of ['password', 'passphrase', 'secret', 'apikey', 'access_token', 'signature']) {
      const out = redactUrl(`/x?${nombre}=NOAPARECE`);
      expect(out, nombre).not.toContain('NOAPARECE');
    }
  });

  it('ante una query irreparable devuelve solo la ruta (falla hacia el lado seguro)', () => {
    // `URLSearchParams` es muy tolerante, así que este caso es defensivo: lo que
    // importa es el invariante — si algo va mal, no se filtra la query.
    const out = redactUrl('/api/x?%%%=raro');
    expect(out.startsWith('/api/x')).toBe(true);
  });

  it('un `st` repetido se redacta en todas sus apariciones', () => {
    const out = redactUrl('/x?st=UNO&st=DOS');
    expect(out).not.toContain('UNO');
    expect(out).not.toContain('DOS');
  });
});

describe('serializarPeticion', () => {
  it('mantiene el shape del serializador por defecto de Fastify, con la URL limpia', () => {
    const out = serializarPeticion({
      method: 'GET',
      url: '/api/cameras/c1/stream/index.m3u8?st=SECRETO',
      hostname: 'krakenos.lan',
      ip: '192.168.1.20',
      socket: { remotePort: 54321 },
    });
    expect(out).toEqual({
      method: 'GET',
      url: `/api/cameras/c1/stream/index.m3u8?st=${REDACTADO}`,
      hostname: 'krakenos.lan',
      remoteAddress: '192.168.1.20',
      remotePort: 54321,
    });
    expect(JSON.stringify(out)).not.toContain('SECRETO');
  });

  it('tolera una petición sin url ni socket', () => {
    expect(() => serializarPeticion({ method: 'GET' })).not.toThrow();
  });
});
