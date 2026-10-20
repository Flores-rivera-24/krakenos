import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  esBloqueoPasajero,
  renameSyncWithRetry,
  renameWithRetry,
} from '../../src/system/rename-retry.js';

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`${code}: simulado`), { code });
}

describe('renameWithRetry (US-280)', () => {
  it('falla dos veces con EPERM/EBUSY y a la tercera lo consigue, esperando con backoff', async () => {
    const codigos = ['EPERM', 'EBUSY'];
    let llamadas = 0;
    const esperas: number[] = [];
    await renameWithRetry('a', 'b', {
      rename: async () => {
        llamadas++;
        const code = codigos.shift();
        if (code) throw errno(code);
      },
      sleep: async (ms) => void esperas.push(ms),
    });
    expect(llamadas).toBe(3);
    expect(esperas).toEqual([20, 40]);
  });

  it('agota el tope y propaga el error ORIGINAL', async () => {
    let llamadas = 0;
    const error = errno('EACCES');
    await expect(
      renameWithRetry('a', 'b', {
        attempts: 4,
        rename: async () => {
          llamadas++;
          throw error;
        },
        sleep: async () => undefined,
      }),
    ).rejects.toBe(error);
    expect(llamadas).toBe(4);
  });

  it.each(['ENOENT', 'EXDEV', 'EEXIST'])('no reintenta un %s (no es pasajero)', async (code) => {
    let llamadas = 0;
    await expect(
      renameWithRetry('a', 'b', {
        rename: async () => {
          llamadas++;
          throw errno(code);
        },
        sleep: async () => {
          throw new Error('no debería esperar');
        },
      }),
    ).rejects.toMatchObject({ code });
    expect(llamadas).toBe(1);
  });

  it('un error sin código (no es del SO) tampoco se reintenta', async () => {
    let llamadas = 0;
    await expect(
      renameWithRetry('a', 'b', {
        rename: async () => {
          llamadas++;
          throw new Error('otra cosa');
        },
        sleep: async () => undefined,
      }),
    ).rejects.toThrow('otra cosa');
    expect(llamadas).toBe(1);
  });

  it('por defecto el tope son 5 intentos (~0,3 s de espera acumulada)', async () => {
    let llamadas = 0;
    const esperas: number[] = [];
    await expect(
      renameWithRetry('a', 'b', {
        rename: async () => {
          llamadas++;
          throw errno('EBUSY');
        },
        sleep: async (ms) => void esperas.push(ms),
      }),
    ).rejects.toMatchObject({ code: 'EBUSY' });
    expect(llamadas).toBe(5);
    expect(esperas).toEqual([20, 40, 80, 160]);
  });

  it('con el rename real mueve el fichero', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'krakenos-rr-'));
    try {
      writeFileSync(join(dir, 'a'), 'hola');
      await renameWithRetry(join(dir, 'a'), join(dir, 'b'));
      expect(readFileSync(join(dir, 'b'), 'utf8')).toBe('hola');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('renameSyncWithRetry (US-280)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('reintenta dos EPERM y lo consigue', () => {
    const codigos = ['EPERM', 'EACCES'];
    let llamadas = 0;
    const esperas: number[] = [];
    renameSyncWithRetry('a', 'b', {
      rename: () => {
        llamadas++;
        const code = codigos.shift();
        if (code) throw errno(code);
      },
      sleep: (ms) => void esperas.push(ms),
    });
    expect(llamadas).toBe(3);
    expect(esperas).toEqual([20, 40]);
  });

  it('agota el tope y propaga; no reintenta un ENOENT', () => {
    let llamadas = 0;
    expect(() =>
      renameSyncWithRetry('a', 'b', {
        attempts: 3,
        rename: () => {
          llamadas++;
          throw errno('EBUSY');
        },
        sleep: () => undefined,
      }),
    ).toThrow(/EBUSY/);
    expect(llamadas).toBe(3);

    llamadas = 0;
    expect(() =>
      renameSyncWithRetry('a', 'b', {
        rename: () => {
          llamadas++;
          throw errno('ENOENT');
        },
        sleep: () => {
          throw new Error('no debería esperar');
        },
      }),
    ).toThrow(/ENOENT/);
    expect(llamadas).toBe(1);
  });

  it('con el rename real y la espera real mueve el fichero', () => {
    const dir = mkdtempSync(join(tmpdir(), 'krakenos-rr-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'a'), 'hola');
    renameSyncWithRetry(join(dir, 'a'), join(dir, 'b'));
    expect(readFileSync(join(dir, 'b'), 'utf8')).toBe('hola');
  });

  it('la espera síncrona real (Atomics.wait) no explota y espera algo', () => {
    let llamadas = 0;
    const t0 = Date.now();
    renameSyncWithRetry('a', 'b', {
      baseDelayMs: 15,
      rename: () => {
        if (llamadas++ === 0) throw errno('EBUSY');
      },
    });
    expect(llamadas).toBe(2);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(10);
  });
});

describe('esBloqueoPasajero', () => {
  it('solo EPERM, EBUSY y EACCES', () => {
    for (const c of ['EPERM', 'EBUSY', 'EACCES']) expect(esBloqueoPasajero(errno(c))).toBe(true);
    for (const c of ['ENOENT', 'EXDEV', 'ENOSPC']) expect(esBloqueoPasajero(errno(c))).toBe(false);
    expect(esBloqueoPasajero(null)).toBe(false);
    expect(esBloqueoPasajero('EPERM')).toBe(false);
  });
});
