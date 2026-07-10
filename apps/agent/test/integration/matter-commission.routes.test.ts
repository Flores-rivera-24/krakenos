import type { IotManager, MatterCommissionResult } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MatterCommissionError } from '../../src/iot/matter.iot.js';
import { MockIotManager } from '../../src/iot/mock.iot.js';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/** IoT falso que soporta comisionado, para el camino feliz/errores de la ruta. */
class CommissionableIot extends MockIotManager {
  outcome: 'ok' | 'error' = 'ok';
  async commission(code: string): Promise<MatterCommissionResult> {
    if (this.outcome === 'error') throw new MatterCommissionError('invalid-code', `código ${code} inválido`);
    return { deviceId: 'matter:9', name: 'Bombilla nueva' };
  }
}

describe('rutas de comisionado Matter (US-172)', () => {
  const apps: FastifyInstance[] = [];
  async function app(iot?: IotManager) {
    const a = await buildTestApp({ routes: true, ...(iot ? { iot } : {}) });
    apps.push(a);
    await resetDb(a);
    return a;
  }

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  beforeEach(() => {});

  it('409 si la integración IoT activa no soporta Matter', async () => {
    const a = await app(); // MockIotManager, sin commission
    const admin = await seedUser(a, { role: 'admin' });
    const res = await a.inject({
      method: 'POST',
      url: '/api/iot/matter/commission',
      headers: authHeader(signAccess(a, admin)),
      payload: { code: 'MT:ABC123' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('MATTER_UNAVAILABLE');
  });

  it('201 al comisionar con un backend Matter', async () => {
    const iot = new CommissionableIot();
    const a = await app(iot);
    const admin = await seedUser(a, { role: 'admin' });
    const res = await a.inject({
      method: 'POST',
      url: '/api/iot/matter/commission',
      headers: authHeader(signAccess(a, admin)),
      payload: { code: 'MT:ABC123' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ deviceId: 'matter:9', name: 'Bombilla nueva' });
  });

  it('400 con código estable ante un fallo del controlador', async () => {
    const iot = new CommissionableIot();
    iot.outcome = 'error';
    const a = await app(iot);
    const admin = await seedUser(a, { role: 'admin' });
    const res = await a.inject({
      method: 'POST',
      url: '/api/iot/matter/commission',
      headers: authHeader(signAccess(a, admin)),
      payload: { code: 'MT:BADCODE' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid-code');
  });

  it('un viewer no puede comisionar (403)', async () => {
    const iot = new CommissionableIot();
    const a = await app(iot);
    const viewer = await seedUser(a, { role: 'viewer' });
    const res = await a.inject({
      method: 'POST',
      url: '/api/iot/matter/commission',
      headers: authHeader(signAccess(a, viewer)),
      payload: { code: 'MT:ABC123' },
    });
    expect(res.statusCode).toBe(403);
  });
});
