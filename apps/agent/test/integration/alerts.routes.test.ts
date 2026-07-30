import type { AlertRule } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ALERT_EVENTS, AlertConfigService } from '../../src/alerts/alert-config.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/** Reglas de alerta configurables (US-112). */
describe('reglas de alerta (US-112)', () => {
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
    adminToken = signAccess(app, await seedUser(app, { role: 'admin' }));
    viewerToken = signAccess(app, await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' }));
  });

  it('lista el catálogo de reglas con los valores por defecto (lectura auth)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules',
      headers: authHeader(viewerToken),
    });
    expect(res.statusCode).toBe(200);
    const rules = res.json() as AlertRule[];
    // El catálogo es FIJO y vive en `alerts/alert-config.ts`: se compara contra él
    // en vez de contra un número escrito a mano, que había que recordar tocar en
    // cada historia que añadía un evento (US-183, US-186, US-188, US-227, US-241).
    expect(rules).toHaveLength(ALERT_EVENTS.length);
    // Guard de tamaño: si la importación se rompiera, la lista saldría vacía y la
    // comparación pasaría sola.
    expect(ALERT_EVENTS.length).toBeGreaterThan(8);
    expect(rules.map((r) => r.event).sort()).toEqual(ALERT_EVENTS.map((e) => e.event).sort());
    const block = rules.find((r) => r.event === 'device.block');
    expect(block).toMatchObject({ push: true, email: false });
    expect(rules.some((r) => r.event === 'energy.threshold')).toBe(true);
    expect(rules.some((r) => r.event === 'camera.motion')).toBe(true);
    expect(rules.some((r) => r.event === 'alarm.triggered')).toBe(true);
    expect(rules.some((r) => r.event === 'alarm.disarm_denied')).toBe(true);
  });

  it('un admin cambia una regla y persiste', async () => {
    const patch = await app.inject({
      method: 'PATCH',
      url: '/api/alerts/rules/device.block',
      headers: authHeader(adminToken),
      payload: { email: true, push: false },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json()).toMatchObject({ event: 'device.block', push: false, email: true });

    const list = await app.inject({
      method: 'GET',
      url: '/api/alerts/rules',
      headers: authHeader(adminToken),
    });
    const block = (list.json() as AlertRule[]).find((r) => r.event === 'device.block');
    expect(block).toMatchObject({ push: false, email: true });
  });

  it('404 para un evento fuera del catálogo', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/alerts/rules/foo.bar',
      headers: authHeader(adminToken),
      payload: { push: false },
    });
    expect(res.statusCode).toBe(404);
  });

  it('AlertConfigService.channelsFor refleja la config', async () => {
    const svc = new AlertConfigService(app);
    await svc.ensureDefaults();
    expect(svc.channelsFor('device.block')).toEqual({ push: true, email: false, telegram: false });
    expect(svc.channelsFor('evento.desconocido')).toEqual({
      push: false,
      email: false,
      telegram: false,
    });

    await svc.update('device.block', { push: false, email: true, telegram: true });
    expect(svc.channelsFor('device.block')).toEqual({ push: false, email: true, telegram: true });
  });
});
