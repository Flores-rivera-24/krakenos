import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { authHeader, buildTestApp, resetDb, seedUser, signAccess } from '../helpers/app.js';

/**
 * Contrato de `/api/system/tls` para el respondedor mDNS (US-283). El schema lleva
 * `additionalProperties: false`, que en Fastify PODA: si el campo no está en el schema, el
 * estado desaparece de camino al navegador sin error. Se comparan las claves SERVIDAS.
 */
async function leer(app: FastifyInstance) {
  const u = await seedUser(app, { email: 'v@krakenos.test', role: 'viewer' });
  const res = await app.inject({
    method: 'GET',
    url: '/api/system/tls',
    headers: authHeader(signAccess(app, u)),
  });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe('GET /api/system/tls — mdnsResponder', () => {
  describe('unavailable', () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = await buildTestApp({
        routes: true,
        mdnsStatus: () => ({
          state: 'unavailable',
          reason: 'bind EADDRINUSE 0.0.0.0:5353',
          address: null,
        }),
      });
    });
    afterAll(async () => app.close());
    beforeEach(async () => resetDb(app));

    it('sirve el estado y el motivo completos, sin podar', async () => {
      const body = await leer(app);
      expect(body.mdnsResponder).toEqual({
        state: 'unavailable',
        reason: 'bind EADDRINUSE 0.0.0.0:5353',
        address: null,
      });
      expect(Object.keys(body).sort()).toEqual(
        [
          'behindProxy',
          'daysLeft',
          'disabledFeatures',
          'enabled',
          'expired',
          'expiring',
          'mdnsResponder',
          'notAfter',
          'source',
        ].sort(),
      );
    });
  });

  describe('por defecto', () => {
    let app: FastifyInstance;
    beforeAll(async () => {
      app = await buildTestApp({ routes: true });
    });
    afterAll(async () => app.close());
    beforeEach(async () => resetDb(app));

    it('sin respondedor, el estado es off', async () => {
      expect((await leer(app)).mdnsResponder).toEqual({
        state: 'off',
        reason: null,
        address: null,
      });
    });
  });
});
