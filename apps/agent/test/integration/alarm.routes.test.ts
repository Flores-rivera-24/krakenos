import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

describe('rutas de alarma (US-188)', () => {
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

  const token = async (role: 'admin' | 'member' | 'kid' | 'viewer', email: string) =>
    signAccess(app, await seedUser(app, { email, role }));

  it('GET estado: autenticado; arranca desarmada', async () => {
    const anon = await app.inject({ method: 'GET', url: '/api/alarm' });
    expect(anon.statusCode).toBe(401);
    const t = await token('viewer', 'v@krakenos.test');
    const res = await app.inject({ method: 'GET', url: '/api/alarm', headers: authHeader(t) });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ phase: 'disarmed', mode: null });
  });

  it('armar/desarmar: admin y member sí; kid/viewer no (403)', async () => {
    const admin = await token('admin', 'a@krakenos.test');
    const member = await token('member', 'm@krakenos.test');
    const kid = await token('kid', 'k@krakenos.test');
    const viewer = await token('viewer', 'v2@krakenos.test');

    const arm = (t: string) =>
      app.inject({ method: 'POST', url: '/api/alarm/arm', headers: authHeader(t), payload: { mode: 'away' } });

    expect((await arm(admin)).statusCode).toBe(200);
    expect((await arm(member)).statusCode).toBe(200);
    expect((await arm(kid)).statusCode).toBe(403);
    expect((await arm(viewer)).statusCode).toBe(403);

    const disarmKid = await app.inject({
      method: 'POST',
      url: '/api/alarm/disarm',
      headers: authHeader(kid),
      payload: {},
    });
    expect(disarmKid.statusCode).toBe(403); // kid no desarma
  });

  it('config admin-only: pone PIN; desarmar sin/ con PIN correcto', async () => {
    const admin = await token('admin', 'a3@krakenos.test');
    const member = await token('member', 'm3@krakenos.test');

    // Config es admin-only.
    const memberPut = await app.inject({
      method: 'PUT',
      url: '/api/alarm/config',
      headers: authHeader(member),
      payload: { exitDelaySec: 0, entryDelaySec: 0 },
    });
    expect(memberPut.statusCode).toBe(403);

    // Admin configura PIN + sin retardo.
    const cfg = await app.inject({
      method: 'PUT',
      url: '/api/alarm/config',
      headers: authHeader(admin),
      payload: { pin: '4321', exitDelaySec: 0, entryDelaySec: 0 },
    });
    expect(cfg.statusCode).toBe(200);
    expect(cfg.json()).toMatchObject({ hasPin: true });
    expect(JSON.stringify(cfg.json())).not.toContain('4321'); // el PIN nunca se devuelve

    await app.inject({ method: 'POST', url: '/api/alarm/arm', headers: authHeader(admin), payload: { mode: 'away' } });

    // Desarmar con PIN erróneo → 401; con el correcto → 200.
    const bad = await app.inject({
      method: 'POST',
      url: '/api/alarm/disarm',
      headers: authHeader(admin),
      payload: { pin: '0000' },
    });
    expect(bad.statusCode).toBe(401);

    const ok = await app.inject({
      method: 'POST',
      url: '/api/alarm/disarm',
      headers: authHeader(admin),
      payload: { pin: '4321' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ phase: 'disarmed' });
  });
});
