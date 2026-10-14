import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/**
 * Contrato de respuesta de las rutas que antes no declaraban `schema.response`.
 *
 * Qué agujero tapa. Con `additionalProperties: false` un `response` **poda** en
 * silencio lo que no declara: añadir el schema a una ruta que ya funcionaba puede
 * quitarle campos sin ningún error. Este test fija lo que de verdad sirve cada ruta
 * (estado, cuerpo exacto de los errores y claves/valores del cuerpo de éxito), y se
 * escribió ANTES de declarar los schemas: pasó en verde sin ellos y tiene que seguir
 * en verde con ellos.
 */
describe('contrato de respuesta de las rutas con schema.response añadido', () => {
  let app: FastifyInstance;
  let h: { authorization: string };

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    const admin = await seedUser(app, { role: 'admin' });
    h = authHeader(signAccess(app, admin));
  });

  const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, headers: h, ...(payload ? { payload } : {}) });

  const NOT_FOUND = { code: 'NOT_FOUND', message: 'Usuario no encontrado' };

  it('POST /api/users/:id/password → 204 sin cuerpo; 404 con {code,message}', async () => {
    const u = await seedUser(app, { email: 'x@krakenos.test', role: 'viewer' });
    const ok = await call('POST', `/api/users/${u.id}/password`, {
      password: 'no-es-un-secreto-clave-1',
    });
    expect(ok.statusCode).toBe(204);
    expect(ok.body).toBe('');
    const nf = await call('POST', '/api/users/no-existe/password', {
      password: 'no-es-un-secreto-clave-1',
    });
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toEqual(NOT_FOUND);
  });

  it('DELETE /api/users/:id → 204 sin cuerpo; 404 con {code,message}', async () => {
    const u = await seedUser(app, { email: 'y@krakenos.test', role: 'viewer' });
    const ok = await call('DELETE', `/api/users/${u.id}`);
    expect(ok.statusCode).toBe(204);
    expect(ok.body).toBe('');
    const nf = await call('DELETE', '/api/users/no-existe');
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toEqual(NOT_FOUND);
  });

  it('DELETE /api/users/:id del último admin → 409 con {code,message}', async () => {
    const admin = await app.prisma.user.findFirstOrThrow({ where: { role: 'admin' } });
    const res = await call('DELETE', `/api/users/${admin.id}`);
    expect(res.statusCode).toBe(409);
    expect(Object.keys(res.json()).sort()).toEqual(['code', 'message']);
  });

  it('POST /api/access-requests → 202 sin cuerpo (igual exista o no la cuenta)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/access-requests',
      payload: { email: 'nuevo@krakenos.test', displayName: 'Nuevo' },
    });
    expect(res.statusCode).toBe(202);
    expect(res.body).toBe('');
  });

  it('DELETE /api/access/schedules/:id → 204 sin cuerpo; 404 con {code,message}', async () => {
    const created = await call('POST', '/api/access/schedules', {
      name: 'Dormir',
      mac: 'aa:bb:cc:dd:ee:ff',
      days: [0, 1],
      startMinute: 1260,
      endMinute: 420,
    });
    expect(created.statusCode).toBe(201);
    const ok = await call('DELETE', `/api/access/schedules/${created.json().id}`);
    expect(ok.statusCode).toBe(204);
    expect(ok.body).toBe('');
    const nf = await call('DELETE', '/api/access/schedules/no-existe');
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toEqual({ code: 'NOT_FOUND', message: 'Horario no encontrado' });
  });

  it('DELETE /api/coverage/floorplans/:id → 204; 404 con {code,message}', async () => {
    const fp = await call('POST', '/api/coverage/floorplans', {
      name: 'Planta',
      widthM: 10,
      heightM: 8,
      walls: [],
      accessPoints: [],
    });
    expect(fp.statusCode).toBe(201);
    const ok = await call('DELETE', `/api/coverage/floorplans/${fp.json().id}`);
    expect(ok.statusCode).toBe(204);
    expect(ok.body).toBe('');
    const nf = await call('DELETE', '/api/coverage/floorplans/no-existe');
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toEqual({ code: 'FLOORPLAN_NOT_FOUND', message: 'Plano no encontrado' });
  });

  it('DELETE /api/coverage/scans/:scanId → 204; 404 con {code,message}', async () => {
    const fp = await call('POST', '/api/coverage/floorplans', {
      name: 'Planta',
      widthM: 10,
      heightM: 8,
      walls: [],
      accessPoints: [],
    });
    const scan = await call('POST', `/api/coverage/floorplans/${fp.json().id}/scans`, {
      name: 'Recorrido',
      band: '5GHz',
      deviceMac: 'aa:bb:cc:00:00:01',
    });
    expect(scan.statusCode).toBe(201);
    const ok = await call('DELETE', `/api/coverage/scans/${scan.json().id}`);
    expect(ok.statusCode).toBe(204);
    expect(ok.body).toBe('');
    const nf = await call('DELETE', '/api/coverage/scans/no-existe');
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toEqual({ code: 'SCAN_NOT_FOUND', message: 'Survey no encontrado' });
  });

  it('DELETE /api/auth/sessions/:id → 204; 404 con {code,message}', async () => {
    const u = await seedUser(app, { email: 's@krakenos.test', role: 'viewer' });
    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: u.email, password: u.password },
    });
    const token = (login.json() as { tokens: { accessToken: string } }).tokens.accessToken;
    const mine = { authorization: `Bearer ${token}` };
    const list = await app.inject({ method: 'GET', url: '/api/auth/sessions', headers: mine });
    const id = (list.json() as { id: string }[])[0]!.id;
    const ok = await app.inject({
      method: 'DELETE',
      url: `/api/auth/sessions/${id}`,
      headers: mine,
    });
    expect(ok.statusCode).toBe(204);
    expect(ok.body).toBe('');
    const nf = await app.inject({
      method: 'DELETE',
      url: '/api/auth/sessions/no-existe',
      headers: mine,
    });
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toEqual({ code: 'NOT_FOUND', message: 'Sesión no encontrada' });
  });

  it('POST /api/vlans → 201 con la VLAN completa; 409 con {code,message}', async () => {
    const ok = await call('POST', '/api/vlans', { tag: 2530, name: 'iot', subnet: '10.30.0.0/24' });
    expect(ok.statusCode).toBe(201);
    const body = ok.json();
    expect(Object.keys(body).sort()).toEqual(
      ['createdAt', 'deviceCount', 'id', 'isolated', 'name', 'subnet', 'tag'].sort(),
    );
    expect(body).toMatchObject({ tag: 2530, name: 'iot', subnet: '10.30.0.0/24', deviceCount: 0 });
    expect(typeof body.isolated).toBe('boolean');
    expect(new Date(body.createdAt).toISOString()).toBe(body.createdAt);
    const dup = await call('POST', '/api/vlans', { tag: 2530, name: 'otra' });
    expect(dup.statusCode).toBe(409);
    expect(Object.keys(dup.json()).sort()).toEqual(['code', 'message']);
  });

  it('PATCH /api/vlans/:id → 200 con la VLAN completa; 404 con {code,message}', async () => {
    const created = (await call('POST', '/api/vlans', { tag: 2540, name: 'inv' })).json();
    const ok = await call('PATCH', `/api/vlans/${created.id}`, {
      name: 'invitados',
      isolated: true,
    });
    expect(ok.statusCode).toBe(200);
    const body = ok.json();
    expect(Object.keys(body).sort()).toEqual(
      ['createdAt', 'deviceCount', 'id', 'isolated', 'name', 'subnet', 'tag'].sort(),
    );
    expect(body).toMatchObject({ id: created.id, tag: 2540, name: 'invitados', isolated: true });
    const nf = await call('PATCH', '/api/vlans/no-existe', { name: 'x' });
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toEqual({ code: 'VLAN_NOT_FOUND', message: 'VLAN no encontrada' });
  });

  it('PATCH/DELETE /api/energy/alerts/:id → cuerpo de la regla; 204; 404 con {code,message}', async () => {
    const rule = await call('POST', '/api/energy/alerts', {
      deviceId: 'mock:enchufe',
      metric: 'sustained-power',
      threshold: 100,
    });
    expect(rule.statusCode).toBe(201);
    const id = rule.json().id;
    const up = await call('PATCH', `/api/energy/alerts/${id}`, { threshold: 200 });
    expect(up.statusCode).toBe(200);
    expect(Object.keys(up.json()).sort()).toEqual(
      ['createdAt', 'deviceId', 'enabled', 'id', 'metric', 'sustainMinutes', 'threshold'].sort(),
    );
    const del = await call('DELETE', `/api/energy/alerts/${id}`);
    expect(del.statusCode).toBe(204);
    expect(del.body).toBe('');
    const nf = await call('DELETE', '/api/energy/alerts/no-existe');
    expect(nf.statusCode).toBe(404);
    expect(nf.json()).toEqual({ code: 'NOT_FOUND', message: 'Regla no encontrada' });
  });
});
