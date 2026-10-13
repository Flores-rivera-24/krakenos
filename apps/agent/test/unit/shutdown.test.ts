import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createShutdown,
  DISCONNECT_TIMEOUT_MS,
  type ShutdownApp,
} from '../../src/system/shutdown.js';

function fakeApp(close: () => Promise<unknown>, disconnect?: () => Promise<unknown>) {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const prisma = { $disconnect: vi.fn(disconnect ?? (async () => undefined)) };
  const app: ShutdownApp = { close: vi.fn(close), prisma, log };
  return { app, log, prisma };
}

describe('createShutdown', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('si el cierre termina a tiempo sale con 0 y no toca la base a mano', async () => {
    const { app, prisma } = fakeApp(async () => undefined);
    const exit = vi.fn();
    await createShutdown({ app, exit, timeoutMs: 1000 })('SIGTERM');
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(prisma.$disconnect).not.toHaveBeenCalled();
  });

  it('con un app.close() que nunca resuelve, al agotar el tope cierra la base y sale con 1', async () => {
    const { app, log, prisma } = fakeApp(() => new Promise(() => undefined));
    const exit = vi.fn();
    const p = createShutdown({ app, exit, timeoutMs: 1000 })('SIGTERM');

    await vi.advanceTimersByTimeAsync(999);
    expect(exit).not.toHaveBeenCalled();
    expect(prisma.$disconnect).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(log.warn).toHaveBeenCalledOnce();
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('si la base tampoco responde, sale igualmente tras su propio tope', async () => {
    const { app, prisma } = fakeApp(
      () => new Promise(() => undefined),
      () => new Promise(() => undefined),
    );
    const exit = vi.fn();
    const p = createShutdown({ app, exit, timeoutMs: 1000 })('SIGTERM');
    await vi.advanceTimersByTimeAsync(1000);
    expect(prisma.$disconnect).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DISCONNECT_TIMEOUT_MS);
    await p;
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('si app.close() lanza, lo registra y sale con 1 sin esperar al tope', async () => {
    const { app, log, prisma } = fakeApp(async () => {
      throw new Error('boom');
    });
    const exit = vi.fn();
    await createShutdown({ app, exit, timeoutMs: 1000 })('SIGINT');
    expect(log.error).toHaveBeenCalledOnce();
    expect(prisma.$disconnect).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('uncaughtException: sale con el código pedido tras un cierre limpio', async () => {
    const { app } = fakeApp(async () => undefined);
    const exit = vi.fn();
    await createShutdown({ app, exit })('uncaughtException', 1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('es idempotente: una segunda señal no reinicia el cierre', async () => {
    const { app } = fakeApp(async () => undefined);
    const exit = vi.fn();
    const shutdown = createShutdown({ app, exit });
    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')]);
    expect(app.close).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });
});
