import type { Device } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { type Socket, io as ioClient } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  buildTestApp,
  connectSocket,
  eventually,
  listenOnEphemeralPort,
  resetDb,
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

describe('eventos WebSocket de inventario', () => {
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
    const snapshot = await waitForEvent<Device[]>(client, 'inventory:snapshot');
    expect(Array.isArray(snapshot)).toBe(true);
    expect(snapshot).toHaveLength(0); // DB vacía tras el reset
  });

  it('rechaza la conexión sin access token', async () => {
    const anon = ioClient(baseUrl, { transports: ['websocket'], forceNew: true });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('esperaba connect_error')), 3000);
        anon.on('connect', () => {
          clearTimeout(timer);
          reject(new Error('no debía conectar sin token'));
        });
        anon.on('connect_error', (err: Error) => {
          clearTimeout(timer);
          try {
            expect(err.message).toMatch(/AUTH_/);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });
    } finally {
      anon.close();
    }
  });

  it('inventory:rescan dispara un barrido y emite device-updated', async () => {
    client = connectSocket(app, baseUrl);
    await waitForEvent<Device[]>(client, 'inventory:snapshot');

    const updates: Device[] = [];
    client.on('inventory:device-updated', (d: Device) => updates.push(d));

    client.emit('inventory:rescan');

    // El driver mock descubre 5 dispositivos → 5 eventos device-updated.
    await eventually(() => {
      expect(updates.length).toBeGreaterThanOrEqual(5);
    }, 4000);

    // Y quedaron persistidos.
    expect(await app.prisma.device.count()).toBe(5);
    expect(updates.every((d) => typeof d.mac === 'string')).toBe(true);
  });
});
