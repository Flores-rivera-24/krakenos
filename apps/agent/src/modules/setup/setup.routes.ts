import type { SetupInitRequest } from '@krakenos/types';
import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import type { FastifyPluginAsync } from 'fastify';
import { AuthService } from '../auth/auth.service.js';
import { setupInitSchema, setupStatusSchema } from './setup.schemas.js';

/** ¿El error es una violación de unicidad de Prisma (P2002)? */
function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export const setupRoutes: FastifyPluginAsync = async (app) => {
  const auth = new AuthService(app);

  app.get('/status', { schema: setupStatusSchema }, async () => {
    const count = await app.prisma.user.count();
    return { needsSetup: count === 0 };
  });

  app.post<{ Body: SetupInitRequest }>('/init', { schema: setupInitSchema }, async (req, reply) => {
    const { homeName, email, displayName, password } = req.body;

    // Camino rápido: instalación ya configurada.
    if ((await app.prisma.user.count()) > 0) {
      return reply.code(409).send({
        code: 'SETUP_ALREADY_DONE',
        message: 'El sistema ya está configurado',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    try {
      // Atómico contra carreras (US-53): el admin y el ajuste `homeName` se crean en
      // una sola transacción. `Setting.key` es PK, así que dos `/init` en paralelo no
      // pueden crear ambos `homeName`: el segundo viola la unicidad y la transacción
      // entera se revierte (no queda un admin huérfano). El `email` único da la misma
      // garantía si ambos usan el mismo correo. El perdedor recibe un 409 determinista.
      await app.prisma.$transaction([
        app.prisma.user.create({ data: { email, displayName, passwordHash, role: 'admin' } }),
        app.prisma.setting.create({ data: { key: 'homeName', value: homeName } }),
      ]);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return reply.code(409).send({
          code: 'SETUP_ALREADY_DONE',
          message: 'El sistema ya está configurado',
        });
      }
      throw err;
    }

    // Inicia sesión inmediatamente devolviendo user + tokens.
    const result = await auth.login(email, password);
    app.audit({ action: 'setup.init', userId: result.user.id, ip: req.ip });
    return reply.send(result);
  });
};
