import { describe, expect, it, vi } from 'vitest';
import { CANARY_KEY, createReadinessProbe } from '../../src/system/readiness.js';

/**
 * Readiness con canario de escritura (US-233 / AUD3-21).
 *
 * El fallo que ata: `/health/ready` hacía `SELECT 1`, así que con la tarjeta SD
 * remontada en **solo-lectura** o el **disco lleno** respondía 200 mientras nada se
 * persistía — y es la sonda del HEALTHCHECK de Docker, del bucle del instalador y
 * del healthcheck del actualizador. Los tres daban por sano un sistema muerto.
 */

interface Stub {
  prisma: Parameters<typeof createReadinessProbe>[0]['prisma'];
  queries: number;
  writes: number;
}

function stub({ readOk = true, writeOk = true } = {}): Stub {
  const state = { queries: 0, writes: 0 };
  const prisma = {
    $queryRaw: async () => {
      state.queries += 1;
      if (!readOk) throw new Error('SQLITE_CANTOPEN');
      return [];
    },
    setting: {
      upsert: async () => {
        state.writes += 1;
        // Lo que devuelve SQLite con el FS en solo-lectura o el disco lleno.
        if (!writeOk) throw new Error('SQLITE_READONLY: attempt to write a readonly database');
        return {};
      },
    },
  } as unknown as Stub['prisma'];
  return {
    prisma,
    get queries() {
      return state.queries;
    },
    get writes() {
      return state.writes;
    },
  };
}

describe('createReadinessProbe', () => {
  it('listo cuando se puede leer Y escribir', async () => {
    const s = stub();
    const probe = createReadinessProbe({ prisma: s.prisma, throttleMs: 0 });
    expect(await probe.check()).toBe(true);
    expect(s.queries).toBe(1);
    expect(s.writes).toBe(1);
  });

  it('NO listo si la escritura falla aunque la lectura funcione (el caso de la SD gastada)', async () => {
    const onFail = vi.fn();
    const s = stub({ writeOk: false });
    const probe = createReadinessProbe({ prisma: s.prisma, throttleMs: 0, onFail });
    expect(await probe.check()).toBe(false);
    // La lectura sí pasó: es exactamente el falso positivo que había antes.
    expect(s.queries).toBe(1);
    expect(onFail).toHaveBeenCalled();
  });

  it('NO listo si la base no responde', async () => {
    const probe = createReadinessProbe({ prisma: stub({ readOk: false }).prisma, throttleMs: 0 });
    expect(await probe.check()).toBe(false);
  });

  it('nunca lanza (una sonda que revienta no es una sonda)', async () => {
    const prisma = {
      $queryRaw: async () => {
        throw new Error('boom');
      },
      setting: { upsert: async () => ({}) },
    } as unknown as Stub['prisma'];
    await expect(createReadinessProbe({ prisma, throttleMs: 0 }).check()).resolves.toBe(false);
  });

  it('cachea el resultado: la sonda se llama en bucle y no escribe en cada llamada', async () => {
    let clock = 1_000;
    const s = stub();
    const probe = createReadinessProbe({
      prisma: s.prisma,
      throttleMs: 10_000,
      now: () => clock,
    });
    expect(await probe.check()).toBe(true);
    expect(await probe.check()).toBe(true);
    expect(await probe.check()).toBe(true);
    expect(s.writes).toBe(1);

    // Pasado el throttle vuelve a comprobar de verdad.
    clock += 10_001;
    expect(await probe.check()).toBe(true);
    expect(s.writes).toBe(2);
  });

  it('vuelve a «listo» cuando el disco se recupera (no se queda pegado en fallo)', async () => {
    let clock = 0;
    let writeOk = false;
    const prisma = {
      $queryRaw: async () => [],
      setting: {
        upsert: async () => {
          if (!writeOk) throw new Error('SQLITE_FULL');
          return {};
        },
      },
    } as unknown as Stub['prisma'];
    const probe = createReadinessProbe({ prisma, throttleMs: 1_000, now: () => clock });
    expect(await probe.check()).toBe(false);
    writeOk = true;
    clock += 1_001;
    expect(await probe.check()).toBe(true);
  });

  it('llamadas concurrentes comparten una sola comprobación (single-flight)', async () => {
    const s = stub();
    const probe = createReadinessProbe({ prisma: s.prisma, throttleMs: 10_000 });
    const [a, b, c] = await Promise.all([probe.check(), probe.check(), probe.check()]);
    expect([a, b, c]).toEqual([true, true, true]);
    expect(s.writes).toBe(1);
  });

  it('la fila canario tiene su propia clave (no pisa un ajuste del usuario)', () => {
    expect(CANARY_KEY).toBe('health.canary');
  });
});
