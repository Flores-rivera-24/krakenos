import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ALARM_PIN_FAILURE_THRESHOLD,
  alarmPinLockout,
} from '../../src/modules/alarm/alarm.lockout.js';
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
    // El lockout del PIN es un singleton de módulo: sin esto, los intentos de un
    // test se arrastran al siguiente.
    alarmPinLockout.reset();
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

  /**
   * Fuerza bruta del PIN (AUD3-03, US-227). La ruta no declaraba `config.rateLimit`
   * y el plugin se registra con `global: false`, así que **no tenía ningún límite**:
   * un PIN de 4 dígitos son 10.000 intentos a ~70 ms de bcrypt. El lockout por
   * sujeto es el gate de verdad (el límite por IP no frena a quien rota de IP).
   */
  it('bloquea el desarme tras N intentos con PIN incorrecto (429 + Retry-After)', async () => {
    const admin = await token('admin', 'brute@krakenos.test');
    await app.inject({
      method: 'PUT',
      url: '/api/alarm/config',
      headers: authHeader(admin),
      payload: { pin: '4321', exitDelaySec: 0, entryDelaySec: 0 },
    });
    await app.inject({
      method: 'POST',
      url: '/api/alarm/arm',
      headers: authHeader(admin),
      payload: { mode: 'away' },
    });

    const attempt = (pin: string) =>
      app.inject({
        method: 'POST',
        url: '/api/alarm/disarm',
        headers: authHeader(admin),
        payload: { pin },
      });

    for (let i = 0; i < ALARM_PIN_FAILURE_THRESHOLD; i++) {
      expect((await attempt('0000')).statusCode).toBe(401);
    }

    // Superado el umbral, ni siquiera el PIN correcto pasa: el atacante no puede
    // seguir probando, y tampoco descubre si acertó.
    const locked = await attempt('4321');
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ code: 'ALARM_PIN_LOCKED' });
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);

    // Y el bloqueo es la única causa: pasado el castigo, el PIN correcto funciona.
    alarmPinLockout.reset();
    expect((await attempt('4321')).statusCode).toBe(200);
  });

  it('un desarme correcto limpia el contador de intentos', async () => {
    const admin = await token('admin', 'reset@krakenos.test');
    await app.inject({
      method: 'PUT',
      url: '/api/alarm/config',
      headers: authHeader(admin),
      payload: { pin: '4321', exitDelaySec: 0, entryDelaySec: 0 },
    });
    const arm = () =>
      app.inject({
        method: 'POST',
        url: '/api/alarm/arm',
        headers: authHeader(admin),
        payload: { mode: 'away' },
      });
    const disarm = (pin: string) =>
      app.inject({
        method: 'POST',
        url: '/api/alarm/disarm',
        headers: authHeader(admin),
        payload: { pin },
      });

    await arm();
    // 4 fallos (uno menos que el umbral) y un acierto: el contador vuelve a cero.
    for (let i = 0; i < ALARM_PIN_FAILURE_THRESHOLD - 1; i++) {
      expect((await disarm('0000')).statusCode).toBe(401);
    }
    expect((await disarm('4321')).statusCode).toBe(200);

    await arm();
    for (let i = 0; i < ALARM_PIN_FAILURE_THRESHOLD - 1; i++) {
      expect((await disarm('0000')).statusCode).toBe(401);
    }
    expect((await disarm('4321')).statusCode).toBe(200);
  });
});
