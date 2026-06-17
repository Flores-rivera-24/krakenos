import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/** Crea un dispositivo directamente en la DB y devuelve su id. */
async function seedDevice(app: FastifyInstance, mac: string, vlanTag: number | null = null) {
  const d = await app.prisma.device.create({
    data: { mac, ip: '10.0.0.5', vlanTag },
  });
  return d.id;
}

describe('rutas de VLANs', () => {
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
    const res = await app.inject({ method: 'GET', url: '/api/vlans' });
    expect(res.statusCode).toBe(401);
  });

  it('un viewer puede listar pero no crear', async () => {
    const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
    const token = signAccess(app, viewer);

    const list = await app.inject({ method: 'GET', url: '/api/vlans', headers: authHeader(token) });
    expect(list.statusCode).toBe(200);
    expect(Array.isArray(list.json())).toBe(true);

    const create = await app.inject({
      method: 'POST',
      url: '/api/vlans',
      headers: authHeader(token),
      payload: { tag: 70, name: 'Nope' },
    });
    expect(create.statusCode).toBe(403);
  });

  it('lista VLANs con el número de dispositivos por tag', async () => {
    const admin = await seedUser(app);
    await seedDevice(app, 'aa:aa:aa:aa:aa:01', 30);
    await seedDevice(app, 'aa:aa:aa:aa:aa:02', 30);

    const res = await app.inject({
      method: 'GET',
      url: '/api/vlans',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(res.statusCode).toBe(200);
    const iot = res.json().find((v: { tag: number }) => v.tag === 30);
    expect(iot.deviceCount).toBe(2);
  });

  it('crea una VLAN (201) y rechaza un tag duplicado (409)', async () => {
    const admin = await seedUser(app);
    const token = signAccess(app, admin);

    const created = await app.inject({
      method: 'POST',
      url: '/api/vlans',
      headers: authHeader(token),
      payload: { tag: 80, name: 'Trabajo', subnet: '10.0.80.0/24', isolated: true },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().tag).toBe(80);
    expect(created.json().deviceCount).toBe(0);

    const dup = await app.inject({
      method: 'POST',
      url: '/api/vlans',
      headers: authHeader(token),
      payload: { tag: 80, name: 'Otra' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('valida el rango del tag (400)', async () => {
    const admin = await seedUser(app);
    const res = await app.inject({
      method: 'POST',
      url: '/api/vlans',
      headers: authHeader(signAccess(app, admin)),
      payload: { tag: 5000, name: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('elimina una VLAN y desasigna sus dispositivos', async () => {
    const admin = await seedUser(app);
    const token = signAccess(app, admin);
    // Tag propio de este test: el MockVlanManager se comparte entre tests del
    // archivo (solo la DB se resetea), así que se evita reutilizar tags.
    const deviceId = await seedDevice(app, 'bb:bb:bb:bb:bb:01', 90);
    const created = await app.inject({
      method: 'POST',
      url: '/api/vlans',
      headers: authHeader(token),
      payload: { tag: 90, name: 'Temporal' },
    });
    const id = created.json().id;

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/vlans/${id}`,
      headers: authHeader(token),
    });
    expect(del.statusCode).toBe(204);

    const device = await app.prisma.device.findUnique({ where: { id: deviceId } });
    expect(device?.vlanTag).toBeNull();

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/vlans/${id}`,
      headers: authHeader(token),
    });
    expect(again.statusCode).toBe(404);
  });
});
