import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

describe('rutas de bienestar digital (US-184)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  it('exige autenticación', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/wellbeing/usage' });
    expect(res.statusCode).toBe(401);
  });

  it('devuelve el uso por persona con la forma esperada', async () => {
    const user = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/wellbeing/usage?range=week',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.range).toBe('week');
    expect(Array.isArray(body.people)).toBe(true);
  });

  it('los aparatos sin dueño salen con name null y el contrato conserva todas las claves', async () => {
    // El agente no manda «Sin asignar»/«Desconocido» (copy sin traducir): manda null.
    const admin = await seedUser(app, { role: 'admin' });
    await app.prisma.device.create({ data: { mac: 'cc:cc:cc:00:00:03', ip: '1.1.1.3' } });
    await app.prisma.deviceTrafficSample.create({
      data: { mac: 'cc:cc:cc:00:00:03', rxBytesPerSec: 200, txBytesPerSec: 0 },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/wellbeing/usage?range=week',
      headers: authHeader(signAccess(app, admin)),
    });
    const sinDueno = res.json().people.find((p: { userId: string | null }) => p.userId === null);
    expect(sinDueno, 'el grupo sin dueño tiene que salir').toBeTruthy();
    expect(sinDueno.name).toBeNull();
    expect(Object.keys(sinDueno).sort()).toEqual([
      'buckets',
      'deviceCount',
      'name',
      'rxBytes',
      'totalBytes',
      'txBytes',
      'userId',
    ]);
  });

  it('rechaza un rango inválido con 400', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/wellbeing/usage?range=month',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(400);
  });

  it('un member solo ve su propio uso (privacidad por rol)', async () => {
    const member = await seedUser(app, { role: 'member', email: 'm@test' });
    const other = await seedUser(app, { role: 'member', email: 'o@test' });
    await app.prisma.device.create({
      data: { mac: 'aa:aa:aa:00:00:01', ip: '1.1.1.1', ownerId: member.id },
    });
    await app.prisma.device.create({
      data: { mac: 'bb:bb:bb:00:00:02', ip: '1.1.1.2', ownerId: other.id },
    });
    await app.prisma.deviceTrafficSample.create({
      data: { mac: 'aa:aa:aa:00:00:01', rxBytesPerSec: 100, txBytesPerSec: 100 },
    });
    await app.prisma.deviceTrafficSample.create({
      data: { mac: 'bb:bb:bb:00:00:02', rxBytesPerSec: 999, txBytesPerSec: 999 },
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/wellbeing/usage?range=week',
      headers: authHeader(signAccess(app, member)),
    });
    const body = res.json();
    expect(body.people).toHaveLength(1);
    expect(body.people[0].userId).toBe(member.id);
  });
});
