import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthError, AuthService } from '../../src/modules/auth/auth.service.js';
import { buildTestApp, resetDb, seedUser } from '../helpers/app.js';

/**
 * Rama de error de `refresh()` que el camino feliz no toca (US-99): un refresh
 * token con **firma válida y type correcto** pero **sin registro en la DB**
 * (forjado con la clave, o cuya fila se borró). Debe rechazarse con
 * `AUTH_INVALID_TOKEN`, no emitir sesión.
 */
describe('AuthService.refresh — token válido pero ausente en DB (US-99)', () => {
  let app: FastifyInstance;
  let service: AuthService;

  beforeAll(async () => {
    app = await buildTestApp();
    service = new AuthService(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  it('rechaza con AUTH_INVALID_TOKEN un refresh firmado que nunca se persistió', async () => {
    const user = await seedUser(app);
    // Refresh con firma y type correctos, pero sin fila en RefreshToken.
    const orphanRefresh = app.jwt.sign(
      { sub: user.id, type: 'refresh', jti: randomUUID() },
      { expiresIn: 3600 },
    );

    await expect(service.refresh(orphanRefresh)).rejects.toMatchObject({
      code: 'AUTH_INVALID_TOKEN',
    });
    await expect(service.refresh(orphanRefresh)).rejects.toBeInstanceOf(AuthError);

    // No se emitió ni persistió ninguna sesión a partir del token huérfano.
    expect(await app.prisma.refreshToken.count()).toBe(0);
  });
});
