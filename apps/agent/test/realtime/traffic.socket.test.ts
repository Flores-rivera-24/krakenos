import type { TrafficSample } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MockDriver } from '../../src/drivers/mock.driver.js';
import { TrafficService } from '../../src/modules/traffic/traffic.service.js';
import { buildTestApp, connectSocket, listenOnEphemeralPort } from '../helpers/app.js';

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

describe('eventos WebSocket de tráfico', () => {
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

  afterEach(() => {
    if (client?.connected) client.disconnect();
  });

  it('entrega el histórico al conectar', async () => {
    client = connectSocket(app, baseUrl);
    const history = await waitForEvent<TrafficSample[]>(client, 'traffic:history');
    expect(Array.isArray(history)).toBe(true);
  });

  it('emite traffic:sample al room cuando el servicio muestrea', async () => {
    client = connectSocket(app, baseUrl);
    await waitForEvent<TrafficSample[]>(client, 'traffic:history');

    // Otro servicio sobre el mismo io emite al room TRAFFIC_ROOM que el cliente ya unió.
    const service = new TrafficService(app, new MockDriver());
    const received = waitForEvent<TrafficSample>(client, 'traffic:sample');
    const emitted = await service.sampleOnce();

    const sample = await received;
    expect(sample.timestamp).toBe(emitted.timestamp);
    expect(sample.rxBytesPerSec).toBeGreaterThanOrEqual(0);
    expect(sample.txBytesPerSec).toBeGreaterThanOrEqual(0);
  });
});
