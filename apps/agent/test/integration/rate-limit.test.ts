import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, resetDb, seedUser } from '../helpers/app.js';

/**
 * El login está limitado a 10 intentos por minuto (US-07). Verificamos que la
 * 11ª petición desde la misma IP recibe 429, registrando el rate-limit real
 * de `@fastify/rate-limit`.
 */
describe('rate-limit en /api/auth/login', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true, rateLimit: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  it('permite 10 intentos y bloquea el 11º con 429', async () => {
    await seedUser(app, { email: 'rl@krakenos.test', password: 'password123' });

    const attempt = () =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'rl@krakenos.test', password: 'incorrecta' },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await attempt()).statusCode);
    }
    // Los 10 primeros pasan el limitador (aquí 401 por credenciales malas).
    expect(statuses.every((s) => s === 401)).toBe(true);

    const blocked = await attempt();
    expect(blocked.statusCode).toBe(429);
  });
});
