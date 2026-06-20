import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MemoryJsonStore } from '../../src/store/json-store.js';
import type { TuyaDeviceRecord } from '../../src/iot/tuya.store.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

const DEVICE = {
  deviceId: 'dev-1',
  localKey: 'abcdef0123456789',
  ip: '192.168.1.80',
  name: 'Foco salón',
} as const;

describe('rutas de config Tuya', () => {
  let app: FastifyInstance;
  let store: MemoryJsonStore<TuyaDeviceRecord>;

  beforeEach(async () => {
    store = new MemoryJsonStore<TuyaDeviceRecord>();
    app = await buildTestApp({ routes: true, tuyaStore: store });
    await resetDb(app);
  });

  afterEach(async () => {
    await app.close();
  });

  it('POST /api/iot/tuya/devices crea una entrada en el store (201)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/iot/tuya/devices',
      headers: authHeader(signAccess(app, admin)),
      payload: DEVICE,
    });
    expect(res.statusCode).toBe(201);
    expect(await store.get('dev-1')).toMatchObject({ id: 'dev-1', localKey: 'abcdef0123456789' });
  });

  it('GET /api/iot/tuya/devices lista sin exponer la localKey', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    await store.upsert({ ...DEVICE, id: DEVICE.deviceId });

    const res = await app.inject({
      method: 'GET',
      url: '/api/iot/tuya/devices',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>[];
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({ deviceId: 'dev-1', ip: '192.168.1.80', name: 'Foco salón' });
    expect(body[0]).not.toHaveProperty('localKey');
  });

  it('un viewer no puede gestionar la config Tuya (403)', async () => {
    const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/iot/tuya/devices',
      headers: authHeader(signAccess(app, viewer)),
    });
    expect(res.statusCode).toBe(403);
  });

  it('PATCH /api/iot/tuya/devices/:deviceId actualiza la IP', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    await store.upsert({ ...DEVICE, id: DEVICE.deviceId });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/iot/tuya/devices/dev-1',
      headers: authHeader(signAccess(app, admin)),
      payload: { ip: '192.168.1.99' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ deviceId: 'dev-1', ip: '192.168.1.99' });
    expect(await store.get('dev-1')).toMatchObject({ ip: '192.168.1.99' });
  });

  it('PATCH a un dispositivo inexistente devuelve 404', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/iot/tuya/devices/no-existe',
      headers: authHeader(signAccess(app, admin)),
      payload: { ip: '192.168.1.99' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/iot/tuya/devices/:deviceId elimina (204)', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    await store.upsert({ ...DEVICE, id: DEVICE.deviceId });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/iot/tuya/devices/dev-1',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(res.statusCode).toBe(204);
    expect(await store.get('dev-1')).toBeNull();
  });
});
