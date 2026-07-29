import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/app.js';

/**
 * PRAGMAs de SQLite (US-228, AUD3-09).
 *
 * La base corría en rollback journal: **cada** escritura tomaba un lock EXCLUSIVE
 * que bloqueaba a todos los lectores, con ~50-90 transacciones por minuto en reposo.
 * Este test fija el modo como contrato — no es un detalle de configuración que se
 * pueda perder en un refactor del plugin.
 */
describe('PRAGMAs de SQLite (US-228)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('la base abre en modo WAL', async () => {
    const rows = await app.prisma.$queryRawUnsafe<{ journal_mode: string }[]>(
      'PRAGMA journal_mode',
    );
    expect(rows[0]?.journal_mode?.toLowerCase()).toBe('wal');
  });

  it('espera en vez de fallar con SQLITE_BUSY, y no hace fsync por commit', async () => {
    const busy = await app.prisma.$queryRawUnsafe<{ timeout: number }[]>('PRAGMA busy_timeout');
    expect(Number(busy[0]?.timeout)).toBeGreaterThanOrEqual(1000);

    // synchronous NORMAL = 1 (FULL = 2). En WAL es el valor recomendado: quita un
    // fsync por commit sin arriesgar la integridad ante caída de proceso.
    const sync = await app.prisma.$queryRawUnsafe<{ synchronous: number }[]>('PRAGMA synchronous');
    expect(Number(sync[0]?.synchronous)).toBe(1);
  });

  it('las claves foráneas están activas', async () => {
    const fk = await app.prisma.$queryRawUnsafe<{ foreign_keys: number }[]>('PRAGMA foreign_keys');
    expect(Number(fk[0]?.foreign_keys)).toBe(1);
  });
});
