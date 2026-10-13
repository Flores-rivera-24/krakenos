import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, connectSocket, listenOnEphemeralPort, sleep } from '../helpers/app.js';

/** Resuelve con 'cerrado' o 'colgado' según si `p` termina antes de `ms`. */
async function terminaEn(p: Promise<unknown>, ms: number): Promise<'cerrado' | 'colgado'> {
  return Promise.race([p.then(() => 'cerrado' as const), sleep(ms).then(() => 'colgado' as const)]);
}

describe('cierre ordenado con clientes conectados', () => {
  let app: FastifyInstance | undefined;
  const sockets: Array<{ disconnect: () => unknown }> = [];

  afterEach(async () => {
    for (const s of sockets.splice(0)) s.disconnect();
    // Si el cierre se colgó, fuerza lo que quede para no dejar el worker bloqueado.
    app?.server.closeAllConnections();
    await app?.close().catch(() => undefined);
    app = undefined;
  });

  it('app.close() termina con un cliente Socket.io autenticado conectado', async () => {
    app = await buildTestApp();
    const url = await listenOnEphemeralPort(app);
    const socket = connectSocket(app, url);
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
    });

    const desconectado = new Promise<void>((resolve) => socket.on('disconnect', () => resolve()));
    expect(await terminaEn(app.close(), 3000)).toBe('cerrado');
    // el cierre ordenado desconecta al cliente
    await desconectado;
  });

  it('app.close() termina con una conexión HTTP keep-alive abierta', async () => {
    app = await buildTestApp();
    await listenOnEphemeralPort(app);
    const agent = new http.Agent({ keepAlive: true });
    const { port } = app.server.address() as AddressInfo;
    await new Promise<void>((resolve, reject) => {
      http
        .get({ host: '127.0.0.1', port, path: '/health', agent }, (res) => {
          res.resume();
          res.on('end', resolve);
        })
        .on('error', reject);
    });

    expect(await terminaEn(app.close(), 3000)).toBe('cerrado');
    agent.destroy();
  });
});
