import type { SetupInitRequest } from '@krakenos/types';
import bcrypt from 'bcrypt';
import type { FastifyPluginAsync } from 'fastify';
import { AuthService } from '../auth/auth.service.js';
import { setupInitSchema, setupStatusSchema } from './setup.schemas.js';

export const setupRoutes: FastifyPluginAsync = async (app) => {
  const auth = new AuthService(app);

  app.get('/status', { schema: setupStatusSchema }, async () => {
    const count = await app.prisma.user.count();
    return { needsSetup: count === 0 };
  });

  app.post<{ Body: SetupInitRequest }>('/init', { schema: setupInitSchema }, async (req, reply) => {
    const { homeName, email, displayName, password } = req.body;

    // Solo permitido en una instalación nueva (sin usuarios).
    const count = await app.prisma.user.count();
    if (count > 0) {
      return reply.code(409).send({
        code: 'SETUP_ALREADY_DONE',
        message: 'El sistema ya está configurado',
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    await app.prisma.user.create({
      data: { email, displayName, passwordHash, role: 'admin' },
    });
    await app.prisma.setting.upsert({
      where: { key: 'homeName' },
      create: { key: 'homeName', value: homeName },
      update: { value: homeName },
    });

    // Inicia sesión inmediatamente devolviendo user + tokens.
    const result = await auth.login(email, password);
    return reply.send(result);
  });
};
