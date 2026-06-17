import { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

/** Expone un único `PrismaClient` y lo cierra al apagar el servidor. */
export const prismaPlugin = fp(async (app: FastifyInstance) => {
  const prisma = new PrismaClient();
  await prisma.$connect();

  app.decorate('prisma', prisma);

  app.addHook('onClose', async (instance) => {
    await instance.prisma.$disconnect();
  });
});
