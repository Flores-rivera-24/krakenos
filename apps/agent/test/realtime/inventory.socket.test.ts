import type { Device } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { type Socket, io as ioClient } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildTestApp, eventually, listenOnEphemeralPort, resetDb } from '../helpers/app.js';

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
    client = ioClient(baseUrl, { transports: ['websocket'], forceNew: true });
    const snapshot = await waitForEvent<Device[]>(client, 'inventory:snapshot');
    expect(Array.isArray(snapshot)).toBe(true);
    expect(snapshot).toHaveLength(0); // DB vacía tras el reset
  });

  it('inventory:rescan dispara un barrido y emite device-updated', async () => {
    client = ioClient(baseUrl, { transports: ['websocket'], forceNew: true });
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
