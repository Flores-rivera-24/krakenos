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

describe('streaming HLS en vivo (US-185)', () => {
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

  const startStream = async (cameraId: string) => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'POST',
      url: `/api/cameras/${cameraId}/stream`,
      headers: authHeader(signAccess(app, user)),
    });
    return res;
  };

  it('POST arranca el stream y devuelve un token efímero (autenticado)', async () => {
    const res = await startStream('cam-entrada');
    expect(res.statusCode).toBe(201);
    const body = res.json() as { cameraId: string; token: string; expiresIn: number };
    expect(body.cameraId).toBe('cam-entrada');
    expect(body.token).toBeTruthy();
    expect(body.expiresIn).toBeGreaterThan(0);
  });

  it('POST sin token → 401; cámara offline → 404', async () => {
    const anon = await app.inject({ method: 'POST', url: '/api/cameras/cam-entrada/stream' });
    expect(anon.statusCode).toBe(401);
    const offline = await startStream('cam-garaje');
    expect(offline.statusCode).toBe(404);
  });

  it('la playlist exige el token de stream en la URL (no el access token)', async () => {
    const { token } = (await startStream('cam-entrada')).json() as { token: string };

    // Sin token → 401.
    const noToken = await app.inject({
      method: 'GET',
      url: '/api/cameras/cam-entrada/stream/index.m3u8',
    });
    expect(noToken.statusCode).toBe(401);

    // Con el token correcto → 200 y content-type HLS, segmentos con `?st=`.
    const ok = await app.inject({
      method: 'GET',
      url: `/api/cameras/cam-entrada/stream/index.m3u8?st=${encodeURIComponent(token)}`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['content-type']).toContain('mpegurl');
    expect(ok.body).toContain('#EXTM3U');
    expect(ok.body).toMatch(/seg0\.ts\?st=/);
  });

  it('un token de otra cámara no sirve (acotado por `cam`)', async () => {
    const { token } = (await startStream('cam-entrada')).json() as { token: string };
    const res = await app.inject({
      method: 'GET',
      url: `/api/cameras/cam-patio/stream/index.m3u8?st=${encodeURIComponent(token)}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('sirve los segmentos con el token y rechaza path traversal', async () => {
    const { token } = (await startStream('cam-entrada')).json() as { token: string };
    const st = encodeURIComponent(token);

    const seg = await app.inject({
      method: 'GET',
      url: `/api/cameras/cam-entrada/stream/seg0.ts?st=${st}`,
    });
    expect(seg.statusCode).toBe(200);
    expect(seg.headers['content-type']).toContain('video/mp2t');

    const traversal = await app.inject({
      method: 'GET',
      url: `/api/cameras/cam-entrada/stream/nope.ts?st=${st}`,
    });
    expect(traversal.statusCode).toBe(404);
  });

  it('DELETE detiene la sesión (la playlist deja de servirse)', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const headers = authHeader(signAccess(app, user));
    const { token } = (
      await app.inject({ method: 'POST', url: '/api/cameras/cam-entrada/stream', headers })
    ).json() as { token: string };
    const st = encodeURIComponent(token);

    expect(
      (await app.inject({ method: 'GET', url: `/api/cameras/cam-entrada/stream/index.m3u8?st=${st}` }))
        .statusCode,
    ).toBe(200);

    const del = await app.inject({
      method: 'DELETE',
      url: '/api/cameras/cam-entrada/stream',
      headers,
    });
    expect(del.statusCode).toBe(204);

    const after = await app.inject({
      method: 'GET',
      url: `/api/cameras/cam-entrada/stream/index.m3u8?st=${st}`,
    });
    expect(after.statusCode).toBe(404); // sesión detenida
  });
});

describe('detección de movimiento — config y eventos (US-186)', () => {
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

  it('GET config devuelve los valores por defecto (desactivada)', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/cameras/cam-entrada/motion',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ cameraId: 'cam-entrada', enabled: false, sensitivity: 'medium' });
    expect(body.arming).toEqual({ mode: 'always' });
  });

  it('PUT config es admin-only y persiste; el viewer recibe 403', async () => {
    const admin = await seedUser(app, { email: 'a@krakenos.test', role: 'admin' });
    const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });

    const forbidden = await app.inject({
      method: 'PUT',
      url: '/api/cameras/cam-entrada/motion',
      headers: authHeader(signAccess(app, viewer)),
      payload: { enabled: true },
    });
    expect(forbidden.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'PUT',
      url: '/api/cameras/cam-entrada/motion',
      headers: authHeader(signAccess(app, admin)),
      payload: { enabled: true, sensitivity: 'high', cooldownSec: 120, arming: { mode: 'schedule', windows: [{ fromMinute: 1320, toMinute: 420 }] } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ enabled: true, sensitivity: 'high', cooldownSec: 120 });

    // Persistió: una nueva lectura lo refleja.
    const read = await app.inject({
      method: 'GET',
      url: '/api/cameras/cam-entrada/motion',
      headers: authHeader(signAccess(app, admin)),
    });
    expect((read.json() as { enabled: boolean }).enabled).toBe(true);
  });

  it('GET eventos exige autenticación y arranca vacío', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/cameras/motion/events' });
    expect(anon.statusCode).toBe(401);
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/cameras/motion/events',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });
});

describe('grabación de clips — rutas (US-187)', () => {
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

  it('lista de clips exige auth y arranca vacía', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/cameras/recordings' });
    expect(anon.statusCode).toBe(401);
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/cameras/recordings',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('config de grabación: lectura auth, escritura admin', async () => {
    const admin = await seedUser(app, { email: 'a@krakenos.test', role: 'admin' });
    const viewer = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });

    const read = await app.inject({
      method: 'GET',
      url: '/api/cameras/recordings/config',
      headers: authHeader(signAccess(app, viewer)),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ retentionDays: 14, clipSeconds: 10 });

    const forbidden = await app.inject({
      method: 'PUT',
      url: '/api/cameras/recordings/config',
      headers: authHeader(signAccess(app, viewer)),
      payload: { retentionDays: 30 },
    });
    expect(forbidden.statusCode).toBe(403);

    const ok = await app.inject({
      method: 'PUT',
      url: '/api/cameras/recordings/config',
      headers: authHeader(signAccess(app, admin)),
      payload: { retentionDays: 30, maxTotalMb: 500, clipSeconds: 15 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ retentionDays: 30, clipSeconds: 15 });
  });

  it('borrar una grabación inexistente → 404 (admin); viewer → 403', async () => {
    const admin = await seedUser(app, { email: 'a2@krakenos.test', role: 'admin' });
    const viewer = await seedUser(app, { email: 'v2@krakenos.test', role: 'viewer' });
    const forbidden = await app.inject({
      method: 'DELETE',
      url: '/api/cameras/recordings/nope',
      headers: authHeader(signAccess(app, viewer)),
    });
    expect(forbidden.statusCode).toBe(403);
    const notFound = await app.inject({
      method: 'DELETE',
      url: '/api/cameras/recordings/nope',
      headers: authHeader(signAccess(app, admin)),
    });
    expect(notFound.statusCode).toBe(404);
  });

  it('descargar una grabación inexistente → 404', async () => {
    const user = await seedUser(app, { role: 'viewer' });
    const res = await app.inject({
      method: 'GET',
      url: '/api/cameras/recordings/nope/download',
      headers: authHeader(signAccess(app, user)),
    });
    expect(res.statusCode).toBe(404);
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
