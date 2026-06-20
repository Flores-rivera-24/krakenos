import type { IotDevice } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authHeader,
  buildTestApp,
  connectSocket,
  listenOnEphemeralPort,
  resetDb,
  seedUser,
  signAccess,
} from '../helpers/app.js';

/** Resuelve con el primer payload del evento, o rechaza al agotar el timeout. */
function waitForEvent<T>(socket: Socket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout esperando "${event}"`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('eventos WebSocket de IoT', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let client: Socket;

  beforeAll(async () => {
    app = await buildTestApp({ routes: true });
    baseUrl = await listenOnEphemeralPort(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await resetDb(app);
  });

  afterEach(() => {
    if (client?.connected) client.disconnect();
  });

  it('entrega un snapshot al conectar', async () => {
    client = connectSocket(app, baseUrl);
    const snapshot = await waitForEvent<IotDevice[]>(client, 'iot:snapshot');
    expect(Array.isArray(snapshot)).toBe(true);
    expect(snapshot.length).toBeGreaterThan(0);
  });

  it('emite iot:device-updated al room tras un PATCH de admin', async () => {
    const admin = await seedUser(app, { role: 'admin' });
    client = connectSocket(app, baseUrl);
    await waitForEvent<IotDevice[]>(client, 'iot:snapshot');

    const received = waitForEvent<IotDevice>(client, 'iot:device-updated');
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/iot/devices/light-salon',
      headers: authHeader(signAccess(app, admin)),
      payload: { on: false },
    });
    expect(res.statusCode).toBe(200);

    const updated = await received;
    expect(updated.id).toBe('light-salon');
    expect(updated.on).toBe(false);
  });
});
