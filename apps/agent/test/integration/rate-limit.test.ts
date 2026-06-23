import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loginLockout } from '../../src/auth/login-lockout.js';
import { buildTestApp, resetDb } from '../helpers/app.js';

/**
 * El login está limitado a 10 intentos por minuto (US-07). Verificamos que la
 * 11ª petición desde la misma IP recibe 429, registrando el rate-limit real
 * de `@fastify/rate-limit`. Se usa un email distinto por intento para aislar el
 * límite por IP del lockout por cuenta (US-77), que de otro modo cortaría antes.
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
    loginLockout.reset();
  });

  it('permite 10 intentos y bloquea el 11º con 429', async () => {
    // Email distinto por intento → un solo fallo por cuenta (sin lockout), pero
    // todos desde la misma IP, así se ejerce el límite por IP.
    const attempt = (i: number) =>
      app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: `rl${i}@krakenos.test`, password: 'incorrecta' },
      });

    const statuses: number[] = [];
    for (let i = 0; i < 10; i++) {
      statuses.push((await attempt(i)).statusCode);
    }
    // Los 10 primeros pasan el limitador (aquí 401 por credenciales malas).
    expect(statuses.every((s) => s === 401)).toBe(true);

    const blocked = await attempt(10);
    expect(blocked.statusCode).toBe(429);
  });
});
