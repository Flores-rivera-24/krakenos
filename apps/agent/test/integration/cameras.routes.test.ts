import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CameraDefinition } from '../../src/cameras/rtsp.cameras.js';
import { MemoryJsonStore } from '../../src/store/json-store.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

describe('rutas de cámaras', () => {
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
    const res = await app.inject({ method: 'GET', url: '/api/cameras' });
    expect(res.statusCode).toBe(401);
  });

  it('lista cámaras a un usuario autenticado', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/cameras',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as unknown[]).length).toBeGreaterThan(0);
  });

  it('devuelve un snapshot de una cámara online', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/cameras/cam-entrada/snapshot',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { image: string }).image).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('una cámara offline o inexistente devuelve 404', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const headers = authHeader(signAccess(app, user));
    const offline = await app.inject({ method: 'GET', url: '/api/cameras/cam-garaje/snapshot', headers });
    const unknown = await app.inject({ method: 'GET', url: '/api/cameras/nope/snapshot', headers });
    expect(offline.statusCode).toBe(404);
    expect(unknown.statusCode).toBe(404);
  });
});

describe('gestión de cámaras desde la UI (US-148)', () => {
  let app: FastifyInstance;
  let store: MemoryJsonStore<CameraDefinition>;
  let adminToken: string;
  let viewerToken: string;

  beforeAll(async () => {
    store = new MemoryJsonStore<CameraDefinition>();
    app = await buildTestApp({ routes: true, cameraStore: store });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    for (const c of await store.list()) await store.removeById(c.id);
    const admin = await seedUser(app, { email: 'admin@krakenos.test', role: 'admin' });
    const viewer = await seedUser(app, { email: 'viewer@krakenos.test', role: 'viewer' });
    adminToken = signAccess(app, admin);
    viewerToken = signAccess(app, viewer);
  });

  const add = (token: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/cameras', headers: authHeader(token), payload });

  it('POST añade una cámara (admin), no expone la rtspUrl, el store la guarda', async () => {
    const res = await add(adminToken, {
      name: 'Puerta',
      rtspUrl: 'rtsp://user:pass@10.0.0.5:554/stream1',
      room: 'Entrada',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Record<string, unknown>;
    expect(body.name).toBe('Puerta');
    expect(body.room).toBe('Entrada');
    expect(body.enabled).toBe(true);
    expect(body.rtspUrl).toBeUndefined(); // credencial nunca en la respuesta

    const stored = await store.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.rtspUrl).toBe('rtsp://user:pass@10.0.0.5:554/stream1');
  });

  it('POST es admin-only (viewer → 403)', async () => {
    const res = await add(viewerToken, { name: 'x', rtspUrl: 'rtsp://x/y' });
    expect(res.statusCode).toBe(403);
  });

  it('POST inválido (sin rtspUrl) → 400', async () => {
    const res = await add(adminToken, { name: 'sin url' });
    expect(res.statusCode).toBe(400);
  });

  it('PATCH edita una cámara existente; inexistente → 404', async () => {
    const created = (await add(adminToken, { name: 'A', rtspUrl: 'rtsp://a/1' })).json() as {
      id: string;
    };
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/cameras/${created.id}`,
      headers: authHeader(adminToken),
      payload: { name: 'A renombrada', enabled: false },
    });
    expect(patch.statusCode).toBe(200);
    const body = patch.json() as Record<string, unknown>;
    expect(body.name).toBe('A renombrada');
    expect(body.enabled).toBe(false);
    expect(body.rtspUrl).toBeUndefined();

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/cameras/nope',
      headers: authHeader(adminToken),
      payload: { name: 'x' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('DELETE elimina; inexistente → 404', async () => {
    const created = (await add(adminToken, { name: 'B', rtspUrl: 'rtsp://b/1' })).json() as {
      id: string;
    };
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/cameras/${created.id}`,
      headers: authHeader(adminToken),
    });
    expect(del.statusCode).toBe(204);
    expect(await store.list()).toHaveLength(0);

    const missing = await app.inject({
      method: 'DELETE',
      url: '/api/cameras/nope',
      headers: authHeader(adminToken),
    });
    expect(missing.statusCode).toBe(404);
  });
});
