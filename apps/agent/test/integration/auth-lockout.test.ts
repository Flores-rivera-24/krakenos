import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BASE_LOCKOUT_MS, FAILURE_THRESHOLD, loginLockout } from '../../src/auth/login-lockout.js';
import { rateLimitStore } from '../../src/plugins/rate-limit-store.js';
import { buildTestApp, resetDb, seedUser } from '../helpers/app.js';
import { esperarAuditoria } from '../helpers/audit.js';

const PASSWORD = 'password123';

/** Instante fijo: el lockout mide sus ventanas con `Date.now()` y el test lo controla. */
const AHORA = new Date('2026-10-13T10:00:00Z');

/**
 * Congela SOLO `Date` (bcrypt, Fastify y Prisma usan timers e I/O reales). Así el
 * bloqueo de 30 s no depende de cuánto tarde la máquina entre el 5º fallo y el 6º
 * intento, ni de un salto del reloj de pared durante una pasada larga (#73).
 * No se usa en el test de auditoría: `eventually` mide su timeout con `Date.now()`
 * y con el reloj congelado no expiraría nunca.
 */
function fijaReloj() {
  vi.useFakeTimers({ toFake: ['Date'], now: AHORA });
}

function attempt(app: FastifyInstance, email: string, password: string) {
  return app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
}

describe('lockout por cuenta en login (US-77, F3)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    loginLockout.reset();
    // Límite por IP alto: aísla el lockout por cuenta del rate limit por IP.
    rateLimitStore.update(1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('bloquea la cuenta (429 + Retry-After) tras alcanzar el umbral de fallos', async () => {
    fijaReloj();
    await seedUser(app, { email: 'lock@krakenos.test', password: PASSWORD });

    // Fallos hasta (incluido) el umbral: todos responden 401.
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      const res = await attempt(app, 'lock@krakenos.test', 'wrong-pass');
      expect(res.statusCode).toBe(401);
    }

    // El siguiente intento —incluso con la contraseña correcta— está bloqueado.
    const locked = await attempt(app, 'lock@krakenos.test', PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().code).toBe('AUTH_ACCOUNT_LOCKED');
    expect(locked.json().retryAfter).toBeGreaterThan(0);
    expect(Number(locked.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('un login correcto antes del umbral limpia el contador', async () => {
    fijaReloj();
    await seedUser(app, { email: 'reset@krakenos.test', password: PASSWORD });

    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      expect((await attempt(app, 'reset@krakenos.test', 'wrong-pass')).statusCode).toBe(401);
    }
    // Aún no bloqueado: login correcto pasa y resetea.
    expect((await attempt(app, 'reset@krakenos.test', PASSWORD)).statusCode).toBe(200);

    // Tras el reset, un nuevo fallo no bloquea de inmediato (cuenta desde cero).
    expect((await attempt(app, 'reset@krakenos.test', 'wrong-pass')).statusCode).toBe(401);
  });

  it('bloquea también un email inexistente (no enumera cuentas)', async () => {
    fijaReloj();
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      expect((await attempt(app, 'ghost@krakenos.test', 'wrong-pass')).statusCode).toBe(401);
    }
    const locked = await attempt(app, 'ghost@krakenos.test', 'whatever12');
    expect(locked.statusCode).toBe(429);
  });

  it('sigue bloqueado 29 s después del 5º fallo (ventana de BASE_LOCKOUT_MS)', async () => {
    fijaReloj();
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      expect((await attempt(app, 'ghost@krakenos.test', 'wrong-pass')).statusCode).toBe(401);
    }
    vi.setSystemTime(new Date(AHORA.getTime() + BASE_LOCKOUT_MS - 1000));
    const locked = await attempt(app, 'ghost@krakenos.test', 'whatever12');
    expect(locked.statusCode).toBe(429);
    expect(locked.json().retryAfter).toBe(1);
  });

  it('el bloqueo caduca 31 s después del 5º fallo', async () => {
    fijaReloj();
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      expect((await attempt(app, 'ghost@krakenos.test', 'wrong-pass')).statusCode).toBe(401);
    }
    vi.setSystemTime(new Date(AHORA.getTime() + BASE_LOCKOUT_MS + 1000));
    expect((await attempt(app, 'ghost@krakenos.test', 'whatever12')).statusCode).toBe(401);
  });

  it('audita el bloqueo (auth.login_locked)', async () => {
    await seedUser(app, { email: 'audit@krakenos.test', password: PASSWORD });
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      await attempt(app, 'audit@krakenos.test', 'wrong-pass');
    }
    const bloqueos = await esperarAuditoria(app, { action: 'auth.login_locked' });
    expect(bloqueos.length).toBeGreaterThan(0);
  });
});
