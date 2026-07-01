import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

interface DomainView {
  domain: string;
  source: string;
  effectiveKind: string;
  current: { kind: string; config: Record<string, unknown>; secretsSet: string[] } | null;
  kinds: { kind: string }[];
}

describe('/api/integrations — API de configuración (US-142)', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    const admin = await seedUser(app, { email: 'admin@krakenos.test', role: 'admin' });
    const viewer = await seedUser(app, { email: 'viewer@krakenos.test', role: 'viewer' });
    adminToken = signAccess(app, admin);
    viewerToken = signAccess(app, viewer);
  });

  const overview = async (): Promise<DomainView[]> => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations',
      headers: authHeader(adminToken),
    });
    return (res.json() as { domains: DomainView[] }).domains;
  };

  it('GET / lista el catálogo y la config efectiva (env por defecto)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/integrations',
      headers: authHeader(adminToken),
    });
    expect(res.statusCode).toBe(200);
    const driver = (await overview()).find((d) => d.domain === 'driver')!;
    expect(driver.source).toBe('env');
    expect(driver.effectiveKind).toBe('mock');
    expect(driver.current).toBeNull();
    expect(driver.kinds.map((k) => k.kind)).toContain('openwrt');
  });

  it('GET / exige autenticación', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/integrations' });
    expect(res.statusCode).toBe(401);
  });

  it('PUT guarda config, recarga en caliente y redacta secretos', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/integrations/driver',
      headers: authHeader(adminToken),
      payload: { kind: 'openwrt', config: { host: '192.168.1.1', username: 'root', password: 's3cr3t', sshPort: 22 } },
    });
    expect(res.statusCode).toBe(200);
    const info = res.json() as DomainView['current'];
    expect(info!.kind).toBe('openwrt');
    expect(info!.config.host).toBe('192.168.1.1');
    expect(info!.config.password).toBeUndefined(); // secreto no expuesto
    expect(info!.secretsSet).toContain('password');

    const driver = (await overview()).find((d) => d.domain === 'driver')!;
    expect(driver.source).toBe('db');
    expect(driver.effectiveKind).toBe('openwrt');
  });

  it('PUT es admin-only (viewer → 403)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/integrations/driver',
      headers: authHeader(viewerToken),
      payload: { kind: 'mock', config: {} },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PUT con kind desconocido → 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/integrations/driver',
      headers: authHeader(adminToken),
      payload: { kind: 'inventado', config: {} },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { code: string }).code).toBe('UNKNOWN_KIND');
  });

  it('POST /:domain/test con mock → ok:true', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/integrations/driver/test',
      headers: authHeader(adminToken),
      payload: { kind: 'mock', config: {} },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { ok: boolean }).ok).toBe(true);
  });

  it('POST test con config incompleta devuelve ok:false (no lanza)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/integrations/driver/test',
      headers: authHeader(adminToken),
      payload: { kind: 'openwrt', config: {} }, // sin host → el driver no se puede construir
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toContain('No se pudo conectar');
  });

  it('DELETE revierte al fallback de env', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/integrations/dns',
      headers: authHeader(adminToken),
      payload: { kind: 'pihole', config: { baseUrl: 'http://pi.casa' } },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/integrations/dns',
      headers: authHeader(adminToken),
    });
    expect(del.statusCode).toBe(204);
    const dns = (await overview()).find((d) => d.domain === 'dns')!;
    expect(dns.source).toBe('env');
  });

  it('iot: guarda un backend con secreto namespaced y lo redacta', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/integrations/iot',
      headers: authHeader(adminToken),
      payload: { kind: 'hue', config: { 'hue.bridgeUrl': 'https://b', 'hue.appKey': 'K3Y' } },
    });
    expect(res.statusCode).toBe(200);
    const info = res.json() as DomainView['current'];
    expect(info!.secretsSet).toContain('hue.appKey');
    expect(info!.config['hue.appKey']).toBeUndefined();
    expect(info!.config['hue.bridgeUrl']).toBe('https://b');
  });

  it('iot es aditivo: conectar un segundo backend conserva el primero y su secreto', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/integrations/iot',
      headers: authHeader(adminToken),
      payload: { kind: 'hue', config: { 'hue.bridgeUrl': 'https://b', 'hue.appKey': 'K3Y' } },
    });
    // Conectar Govee NO debe borrar Hue (luces + enchufes a la vez).
    await app.inject({
      method: 'PUT',
      url: '/api/integrations/iot',
      headers: authHeader(adminToken),
      payload: { kind: 'govee', config: { 'govee.listenPort': 4002 } },
    });

    const iot = (await overview()).find((d) => d.domain === 'iot')!;
    expect(iot.effectiveKind.split(',').sort()).toEqual(['govee', 'hue']);
    expect(iot.current!.secretsSet).toContain('hue.appKey'); // el secreto de hue sobrevive
    expect(iot.current!.config['hue.bridgeUrl']).toBe('https://b');
    expect(iot.current!.config['govee.listenPort']).toBe(4002);
  });
});
