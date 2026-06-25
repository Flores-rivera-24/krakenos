import type { FastifyInstance } from 'fastify';
import { io as ioClient } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, listenOnEphemeralPort, signMfaPending } from '../helpers/app.js';

/**
 * Ramas de error del middleware de handshake de Socket.io (`io.use`). El camino
 * feliz (token de access válido) y "sin token" ya están cubiertos; aquí se
 * ejercen los dos que el mock siempre-éxito nunca toca (US-99):
 *  - un JWT válido pero con `type` ≠ `access` → `AUTH_INVALID_TOKEN`.
 *  - un token corrupto que ni siquiera verifica → `AUTH_UNAUTHORIZED` (catch).
 */
describe('handshake de Socket.io — ramas de rechazo (US-99)', () => {
  let app: FastifyInstance;
  let baseUrl: string;

  beforeAll(async () => {
    app = await buildTestApp();
    baseUrl = await listenOnEphemeralPort(app);
  });

  afterAll(async () => {
    await app.close();
  });

  /** Resuelve con el mensaje del `connect_error`, o rechaza si llega a conectar. */
  function expectConnectError(token: string): Promise<string> {
    const client = ioClient(baseUrl, { transports: ['websocket'], forceNew: true, auth: { token } });
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('esperaba connect_error')), 3000);
      client.on('connect', () => {
        clearTimeout(timer);
        reject(new Error('no debía conectar'));
      });
      client.on('connect_error', (err: Error) => {
        clearTimeout(timer);
        resolve(err.message);
      });
    }).finally(() => client.close());
  }

  it('rechaza un JWT válido cuyo type no es access (p. ej. mfa-pending) → AUTH_INVALID_TOKEN', async () => {
    const mfaPending = signMfaPending(app, 'u1');
    await expect(expectConnectError(mfaPending)).resolves.toBe('AUTH_INVALID_TOKEN');
  });

  it('rechaza un token corrupto que no verifica → AUTH_UNAUTHORIZED (catch)', async () => {
    await expect(expectConnectError('esto.no.es.un.jwt')).resolves.toBe('AUTH_UNAUTHORIZED');
  });
});
