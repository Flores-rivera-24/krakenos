import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FAILURE_THRESHOLD } from '../../src/auth/login-lockout.js';
import { mfaLockout } from '../../src/auth/mfa-lockout.js';
import { rateLimitStore } from '../../src/plugins/rate-limit-store.js';
import { BackupCodeService } from '../../src/webauthn/backup-codes.service.js';
import { buildTestApp, resetDb, seedUser, signMfaPending } from '../helpers/app.js';

const VERIFY = '/api/webauthn/backup-codes/verify';
const PASSKEY = '/api/webauthn/authenticate/verify';
const MALO = 'aaaaa-bbbbb-ccccc-ddddd';

describe('segundo factor: lockout por cuenta y códigos de 80 bits', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await resetDb(app);
    mfaLockout.reset();
    // Límite por IP alto: aísla el lockout por cuenta del rate limit por IP.
    rateLimitStore.update(1000);
  });

  const intento = (email: string, userId: string, code: string, ip = '10.0.0.1') =>
    app.inject({
      method: 'POST',
      url: VERIFY,
      remoteAddress: ip,
      payload: { email, mfaToken: signMfaPending(app, userId), code },
    });

  it('bloquea al usuario tras N fallos seguidos aunque cambie la IP', async () => {
    const user = await seedUser(app, { email: 'lock@krakenos.test' });
    const [bueno] = await new BackupCodeService(app.prisma).generate(user.id);
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      const r = await intento('lock@krakenos.test', user.id, MALO, `10.0.1.${i + 1}`);
      expect(r.statusCode).toBe(401);
    }
    // Otra IP y un código CORRECTO: sigue bloqueado.
    const r = await intento('lock@krakenos.test', user.id, bueno!, '10.0.9.9');
    expect(r.statusCode).toBe(429);
    expect(r.json().code).toBe('AUTH_ACCOUNT_LOCKED');
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
  });

  it('el bloqueo también alcanza al paso de passkey (authenticate/verify)', async () => {
    const user = await seedUser(app, { email: 'pk@krakenos.test' });
    const pedir = (ip: string) =>
      app.inject({
        method: 'POST',
        url: PASSKEY,
        remoteAddress: ip,
        payload: {
          email: 'pk@krakenos.test',
          mfaToken: signMfaPending(app, user.id),
          response: { id: 'x' },
        },
      });
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      expect((await pedir(`10.0.2.${i + 1}`)).statusCode).toBe(401);
    }
    const r = await pedir('10.0.2.99');
    expect(r.statusCode).toBe(429);
    expect(r.json().code).toBe('AUTH_ACCOUNT_LOCKED');
  });

  it('un acierto resetea el contador', async () => {
    const user = await seedUser(app, { email: 'reset@krakenos.test' });
    const codes = await new BackupCodeService(app.prisma).generate(user.id);
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      await intento('reset@krakenos.test', user.id, MALO);
    }
    expect((await intento('reset@krakenos.test', user.id, codes[0]!)).statusCode).toBe(200);
    // Si no se hubiera reseteado, estos fallos ya bloquearían.
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      expect((await intento('reset@krakenos.test', user.id, MALO)).statusCode).toBe(401);
    }
    expect((await intento('reset@krakenos.test', user.id, codes[1]!)).statusCode).toBe(200);
  });

  it('otro usuario no queda afectado por el bloqueo', async () => {
    const a = await seedUser(app, { email: 'a@krakenos.test' });
    const b = await seedUser(app, { email: 'b@krakenos.test' });
    const codesB = await new BackupCodeService(app.prisma).generate(b.id);
    for (let i = 0; i < FAILURE_THRESHOLD; i++) await intento('a@krakenos.test', a.id, MALO);
    expect((await intento('a@krakenos.test', a.id, MALO)).statusCode).toBe(429);
    expect((await intento('b@krakenos.test', b.id, codesB[0]!)).statusCode).toBe(200);
  });

  it('un código con el formato viejo de 48 bits sembrado en la DB sigue verificando', async () => {
    const user = await seedUser(app, { email: 'viejo@krakenos.test' });
    const viejo = 'a1b2-c3d4-e5f6';
    await app.prisma.backupCode.create({
      data: { userId: user.id, codeHash: createHash('sha256').update(viejo).digest('hex') },
    });
    const r = await intento('viejo@krakenos.test', user.id, viejo);
    expect(r.statusCode).toBe(200);
  });

  it('los códigos nuevos tienen 80 bits (20 hex en 4 grupos de 5) y son distintos', async () => {
    const user = await seedUser(app, { email: 'nuevo@krakenos.test' });
    const codes = await new BackupCodeService(app.prisma).generate(user.id);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) {
      expect(c).toMatch(/^[0-9a-f]{5}(-[0-9a-f]{5}){3}$/);
      expect(c.replaceAll('-', '')).toHaveLength(20);
    }
    // Y verifican por la ruta real.
    expect((await intento('nuevo@krakenos.test', user.id, codes[0]!)).statusCode).toBe(200);
  });

  it('el borde rechaza lo que no tiene forma de código (400)', async () => {
    const user = await seedUser(app, { email: 'basura@krakenos.test' });
    for (const code of ['', 'x', 'no-existe', 'a1b2-c3d4', 'zzzz-zzzz-zzzz', 'a1b2c-3d4e5-f6a7b']) {
      const r = await intento('basura@krakenos.test', user.id, code);
      expect(r.statusCode).toBe(400);
    }
  });
});
