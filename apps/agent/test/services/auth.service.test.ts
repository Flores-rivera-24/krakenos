import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuthError, AuthService } from '../../src/modules/auth/auth.service.js';
import { buildTestApp, resetDb, seedUser } from '../helpers/app.js';

describe('AuthService', () => {
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

  describe('login', () => {
    it('devuelve usuario y tokens con credenciales válidas', async () => {
      const seeded = await seedUser(app, { email: 'a@krakenos.test', password: 'correcta1' });
      const result = await service.login('a@krakenos.test', 'correcta1');

      expect(result.user.id).toBe(seeded.id);
      expect(result.user.email).toBe('a@krakenos.test');
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.tokens.accessToken).toBeTruthy();
      expect(result.tokens.refreshToken).toBeTruthy();
      expect(result.tokens.expiresIn).toBe(900);
    });

    it('persiste el hash del refresh token, nunca el token en claro', async () => {
      await seedUser(app, { email: 'a@krakenos.test', password: 'correcta1' });
      const { tokens } = await service.login('a@krakenos.test', 'correcta1');

      const stored = await app.prisma.refreshToken.findMany();
      expect(stored).toHaveLength(1);
      expect(stored[0]?.tokenHash).not.toBe(tokens.refreshToken);
      expect(stored[0]?.revoked).toBe(false);
    });

    it('rechaza una contraseña incorrecta', async () => {
      await seedUser(app, { email: 'a@krakenos.test', password: 'correcta1' });
      await expect(service.login('a@krakenos.test', 'incorrecta')).rejects.toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
      });
    });

    it('rechaza un email inexistente (sin filtrar si existe)', async () => {
      await expect(service.login('fantasma@krakenos.test', 'loquesea1')).rejects.toBeInstanceOf(
        AuthError,
      );
    });
  });

  describe('refresh', () => {
    it('rota el token: emite uno nuevo y revoca el anterior', async () => {
      await seedUser(app, { email: 'a@krakenos.test', password: 'correcta1' });
      const { tokens } = await service.login('a@krakenos.test', 'correcta1');

      const rotated = await service.refresh(tokens.refreshToken);
      expect(rotated.refreshToken).toBeTruthy();
      expect(rotated.refreshToken).not.toBe(tokens.refreshToken);

      // El refresh original ya no sirve (revocado).
      await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({
        code: 'AUTH_INVALID_TOKEN',
      });
      // El nuevo sí.
      await expect(service.refresh(rotated.refreshToken)).resolves.toBeTruthy();
    });

    it('rechaza un refresh token con firma inválida', async () => {
      await expect(service.refresh('no-es-un-jwt')).rejects.toMatchObject({
        code: 'AUTH_INVALID_TOKEN',
      });
    });

    it('rechaza un access token usado como refresh', async () => {
      const access = app.jwt.sign({
        sub: 'x',
        email: 'a@krakenos.test',
        role: 'admin',
        type: 'access',
      });
      await expect(service.refresh(access)).rejects.toMatchObject({ code: 'AUTH_INVALID_TOKEN' });
    });

    it('rechaza un refresh cuyo registro en DB ya expiró', async () => {
      await seedUser(app, { email: 'a@krakenos.test', password: 'correcta1' });
      const { tokens } = await service.login('a@krakenos.test', 'correcta1');

      // El JWT sigue siendo válido por firma, pero su fila en DB expiró.
      await app.prisma.refreshToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({
        code: 'AUTH_INVALID_TOKEN',
      });
    });
  });

  describe('logout', () => {
    it('revoca el refresh token y es idempotente', async () => {
      await seedUser(app, { email: 'a@krakenos.test', password: 'correcta1' });
      const { tokens } = await service.login('a@krakenos.test', 'correcta1');

      await service.logout(tokens.refreshToken);
      const stored = await app.prisma.refreshToken.findFirst();
      expect(stored?.revoked).toBe(true);

      // Repetir no lanza.
      await expect(service.logout(tokens.refreshToken)).resolves.toBeUndefined();
      // Un refresh revocado ya no puede rotarse.
      await expect(service.refresh(tokens.refreshToken)).rejects.toMatchObject({
        code: 'AUTH_INVALID_TOKEN',
      });
    });
  });

  describe('getById', () => {
    it('devuelve el usuario sin el hash, o null si no existe', async () => {
      const seeded = await seedUser(app, { email: 'a@krakenos.test' });
      const user = await service.getById(seeded.id);
      expect(user?.email).toBe('a@krakenos.test');
      expect(user).not.toHaveProperty('passwordHash');

      expect(await service.getById('id-inexistente')).toBeNull();
    });
  });
});
