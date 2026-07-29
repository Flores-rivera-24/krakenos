import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTestApp, resetDb, seedUser } from '../helpers/app.js';

// Mock de web-push: capturamos los envíos sin contactar ningún endpoint real.
// El código lo importa por defecto (`import webpush from 'web-push'`), así que el
// mock expone esos métodos en el export `default`.
const webpushMock = vi.hoisted(() => ({
  generateVAPIDKeys: vi.fn(() => ({ publicKey: 'PUB_KEY', privateKey: 'PRIV_KEY' })),
  setVapidDetails: vi.fn(),
  sendNotification: vi.fn(() => Promise.resolve()),
}));
vi.mock('web-push', () => ({ default: webpushMock }));

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
      // `web-push` solo aplica el timeout si se le pasa: sin él, un endpoint que
      // acepta la conexión y no responde congela el canal de avisos (AUD3-01).
      { timeout: 8_000 },
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

  // ---- Audiencia por rol (AUD3-01, US-227) ----

  /** Crea un usuario con suscripción y devuelve su endpoint. */
  async function seedSubscriber(
    role: 'admin' | 'member' | 'kid' | 'guest' | 'viewer',
    opts: { status?: string; endpoint?: string } = {},
  ): Promise<string> {
    const user = await seedUser(app, { email: `${role}-${Math.random()}@krakenos.test`, role });
    if (opts.status) {
      await app.prisma.user.update({ where: { id: user.id }, data: { status: opts.status } });
    }
    const endpoint = opts.endpoint ?? `https://push.example/${role}-${Math.random()}`;
    await app.prisma.pushSubscription.create({
      data: { userId: user.id, endpoint, p256dh: 'p', auth: 'a' },
    });
    return endpoint;
  }

  /** Endpoints a los que se envió realmente. */
  const sentEndpoints = (): string[] =>
    webpushMock.sendNotification.mock.calls.map(
      (c) => (c[0] as { endpoint: string }).endpoint,
    );

  it('un aviso de seguridad (audiencia admin) NO llega a kid, guest ni viewer', async () => {
    const svc = new PushService(app);
    const adminEndpoint = await seedSubscriber('admin');
    await seedSubscriber('member');
    await seedSubscriber('kid');
    await seedSubscriber('guest');
    await seedSubscriber('viewer');

    await svc.sendToAudience('admin', 'Login fallido', 'Intento desde 1.2.3.4');

    expect(sentEndpoints()).toEqual([adminEndpoint]);
  });

  it('un aviso del hogar llega a admin y member, pero nunca a kid ni guest', async () => {
    const svc = new PushService(app);
    const adminEndpoint = await seedSubscriber('admin');
    const memberEndpoint = await seedSubscriber('member');
    await seedSubscriber('kid');
    await seedSubscriber('guest');

    await svc.sendToAudience('home', '¡Alarma disparada!', 'Activada por Cámara del salón');

    expect(sentEndpoints().sort()).toEqual([adminEndpoint, memberEndpoint].sort());
  });

  it('un usuario deshabilitado deja de recibir aunque conserve su suscripción', async () => {
    const svc = new PushService(app);
    const activeEndpoint = await seedSubscriber('admin');
    await seedSubscriber('admin', { status: 'disabled' });

    await svc.sendToAudience('admin', 't', 'b');

    expect(sentEndpoints()).toEqual([activeEndpoint]);
  });

  it('notifyForAudit usa la audiencia del catálogo (alarma → hogar, login → admin)', async () => {
    const svc = new PushService(app);
    const adminEndpoint = await seedSubscriber('admin');
    const memberEndpoint = await seedSubscriber('member');

    svc.notifyForAudit('alarm.triggered', 'Cámara del salón');
    await vi.waitFor(() => expect(webpushMock.sendNotification).toHaveBeenCalledTimes(2));
    expect(sentEndpoints().sort()).toEqual([adminEndpoint, memberEndpoint].sort());

    webpushMock.sendNotification.mockClear();
    svc.notifyForAudit('auth.login_failed', null, '1.2.3.4');
    await vi.waitFor(() => expect(webpushMock.sendNotification).toHaveBeenCalledTimes(1));
    expect(sentEndpoints()).toEqual([adminEndpoint]);
  });

  it('una suscripción con endpoint no permitido no se usa y se elimina', async () => {
    const svc = new PushService(app);
    // Fila «heredada»: escrita antes de que existiera la guarda del borde (o por un
    // restore). Apunta al IMDS de nube — SSRF ciega desde el agente (AUD3-01).
    const hostile = await seedSubscriber('admin', {
      endpoint: 'https://169.254.169.254/latest/meta-data',
    });
    const good = await seedSubscriber('admin');

    await svc.sendToAudience('admin', 't', 'b');

    expect(sentEndpoints()).toEqual([good]);
    expect(await app.prisma.pushSubscription.count({ where: { endpoint: hostile } })).toBe(0);
  });
});
