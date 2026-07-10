import type { Device } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/** Personalización amable de dispositivos (US-178): icono manual + identificación asistida. */
describe('personalización de dispositivos (US-178)', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    adminToken = signAccess(app, await seedUser(app, { role: 'admin' }));
  });

  it('el admin asigna un icono manual y lo quita (vuelve al inferido)', async () => {
    const row = await app.prisma.device.create({
      data: { mac: 'aa:bb:cc:dd:ff:01', ip: '10.0.0.20' },
    });

    const set = await app.inject({
      method: 'PATCH',
      url: `/api/inventory/devices/${row.id}`,
      headers: authHeader(adminToken),
      payload: { icon: 'tv' },
    });
    expect(set.statusCode).toBe(200);
    expect((set.json() as Device).icon).toBe('tv');
    expect((await app.prisma.device.findUnique({ where: { id: row.id } }))?.icon).toBe('tv');

    const clear = await app.inject({
      method: 'PATCH',
      url: `/api/inventory/devices/${row.id}`,
      headers: authHeader(adminToken),
      payload: { icon: null },
    });
    expect((clear.json() as Device).icon).toBeNull();
  });

  it('un icono fuera del catálogo se rechaza en el borde (400)', async () => {
    const row = await app.prisma.device.create({
      data: { mac: 'aa:bb:cc:dd:ff:02', ip: '10.0.0.21' },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/inventory/devices/${row.id}`,
      headers: authHeader(adminToken),
      payload: { icon: 'unicornio' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('un icono legado/corrupto en la DB se proyecta como null, no miente (AUD-20)', async () => {
    const row = await app.prisma.device.create({
      data: { mac: 'aa:bb:cc:dd:ff:03', ip: '10.0.0.22', icon: 'valor-viejo' },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/inventory/devices',
      headers: authHeader(adminToken),
    });
    const device = (res.json() as Device[]).find((d) => d.id === row.id);
    expect(device?.icon).toBeNull();
  });

  it('sugiere el tipo de un dispositivo desconocido por su hostname/OUI (identify.ts)', async () => {
    await app.prisma.device.create({
      data: {
        mac: 'aa:bb:cc:dd:ff:04',
        ip: '10.0.0.23',
        hostname: 'chromecast-salon',
        type: 'unknown',
      },
    });
    // Ya identificado → sin sugerencia; desconocido sin pistas → sin sugerencia.
    await app.prisma.device.create({
      data: { mac: 'aa:bb:cc:dd:ff:05', ip: '10.0.0.24', hostname: 'tv-dormitorio', type: 'tv' },
    });
    await app.prisma.device.create({
      data: { mac: 'aa:bb:cc:dd:ff:06', ip: '10.0.0.25', hostname: 'x9', type: 'unknown' },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/inventory/devices',
      headers: authHeader(adminToken),
    });
    const byMac = new Map((res.json() as Device[]).map((d) => [d.mac, d]));
    expect(byMac.get('aa:bb:cc:dd:ff:04')?.suggestedType).toBe('tv');
    expect(byMac.get('aa:bb:cc:dd:ff:05')?.suggestedType).toBeNull();
    expect(byMac.get('aa:bb:cc:dd:ff:06')?.suggestedType).toBeNull();
  });
});
