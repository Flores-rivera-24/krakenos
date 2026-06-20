import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, resetDb, seedUser } from '../helpers/app.js';

// Mock de web-push: capturamos los envíos sin contactar ningún endpoint real.
const webpushMock = vi.hoisted(() => ({
  generateVAPIDKeys: vi.fn(() => ({ publicKey: 'PUB_KEY', privateKey: 'PRIV_KEY' })),
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(() => Promise.resolve()),
}));
vi.mock('web-push', () => webpushMock);

import { PushService } from '../../src/modules/push/push.service.js';

describe('PushService (US-45)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
    webpushMock.sendNotification.mockReset().mockResolvedValue(undefined);
    webpushMock.setVapidDetails.mockReset();
  });

  it('sendToUser llama a sendNotification con la suscripción y el payload', async () => {
    const svc = new PushService(app);
    const user = await seedUser(app, { role: 'admin' });
    await app.prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: 'https://push.example/abc', p256dh: 'p', auth: 'a' },
    });

    await svc.sendToUser(user.id, 'Hola', 'Mundo', '/x');

    expect(webpushMock.sendNotification).toHaveBeenCalledTimes(1);
    expect(webpushMock.sendNotification).toHaveBeenCalledWith(
      { endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } },
      JSON.stringify({ title: 'Hola', body: 'Mundo', url: '/x' }),
    );
  });

  it('sendToUser elimina la suscripción si el endpoint devuelve 410 (Gone)', async () => {
    const svc = new PushService(app);
    const user = await seedUser(app, { role: 'admin' });
    await app.prisma.pushSubscription.create({
      data: { userId: user.id, endpoint: 'https://push.example/gone', p256dh: 'p', auth: 'a' },
    });
    webpushMock.sendNotification.mockRejectedValue(
      Object.assign(new Error('gone'), { statusCode: 410 }),
    );

    await svc.sendToUser(user.id, 't', 'b');

    const remaining = await app.prisma.pushSubscription.count({
      where: { endpoint: 'https://push.example/gone' },
    });
    expect(remaining).toBe(0);
  });

  it('sendToAll envía a todas las suscripciones activas', async () => {
    const svc = new PushService(app);
    const u1 = await seedUser(app, { email: 'a@krakenos.test', role: 'admin' });
    const u2 = await seedUser(app, { email: 'b@krakenos.test', role: 'viewer' });
    await app.prisma.pushSubscription.create({
      data: { userId: u1.id, endpoint: 'https://push.example/1', p256dh: 'p', auth: 'a' },
    });
    await app.prisma.pushSubscription.create({
      data: { userId: u2.id, endpoint: 'https://push.example/2', p256dh: 'p', auth: 'a' },
    });

    await svc.sendToAll('t', 'b');

    expect(webpushMock.sendNotification).toHaveBeenCalledTimes(2);
  });
});
