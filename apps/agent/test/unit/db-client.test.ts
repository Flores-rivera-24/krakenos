import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPrismaClient } from '../../src/db/client.js';
import { resolveDbFile } from '../../src/db/database-url.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import { Prisma, type PrismaClient } from '../../src/generated/prisma/client.js';
import { applySqlitePragmas } from '../../src/plugins/prisma.js';

/**
 * US-276 — el cliente de Prisma 7 (adaptador de better-sqlite3) sobre una base real.
 */

const MIGRATIONS = resolve(import.meta.dirname, '../../prisma/migrations');

describe('createPrismaClient (US-276)', () => {
  let dir: string;
  let dbFile: string;
  let prisma: PrismaClient;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'kr-client-'));
    dbFile = join(dir, 'app.db');
    migrateDatabase({ dbFile, migrationsDir: MIGRATIONS, backupDir: join(dir, 'var') });
    prisma = createPrismaClient({ databaseUrl: `file:${dbFile}` });
  });

  afterEach(async () => {
    await prisma.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  });

  it('una transacción con rollback NO se lleva por delante la escritura de otra petición', async () => {
    // El adaptador de Prisma 7 abre una sola conexión: sin `serialized-adapter`, una
    // consulta suelta lanzada con la transacción abierta se ejecuta DENTRO de ella y el
    // ROLLBACK la deshace. Se reproduce de verdad. El código tiene 9 `$transaction` (4
    // interactivas: absorb, push y users ×2) y Prisma envuelve en una los creates anidados;
    // `transacciones-interactivas.test.ts` vigila que dentro solo se use `tx`.
    let ajena: Promise<unknown> = Promise.resolve();
    const orden: string[] = [];
    await prisma
      .$transaction(async (tx) => {
        await tx.setting.create({ data: { key: 'en-tx', value: '1' } });
        ajena = prisma.setting
          .create({ data: { key: 'ajena', value: '1' } })
          .then(() => orden.push('ajena terminada'));
        await new Promise((r) => setTimeout(r, 30));
        orden.push('tx hace rollback');
        throw new Error('rollback a propósito');
      })
      .catch(() => undefined);
    await ajena;

    const claves = (await prisma.setting.findMany({ orderBy: { key: 'asc' } })).map((s) => s.key);
    expect(claves).toEqual(['ajena']); // la de la tx se deshizo; la ajena SOBREVIVE
    expect(orden).toEqual(['tx hace rollback', 'ajena terminada']); // y esperó a que acabara
  });

  it('una transacción que confirma publica todo, y las siguientes consultas no esperan para siempre', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.setting.create({ data: { key: 'a', value: '1' } });
      await tx.setting.create({ data: { key: 'b', value: '2' } });
    });
    // Tres transacciones seguidas y consultas sueltas entre medias: el mutex se libera.
    for (let i = 0; i < 3; i++) {
      await prisma.$transaction([
        prisma.setting.upsert({
          where: { key: `lote-${i}` },
          create: { key: `lote-${i}`, value: String(i) },
          update: {},
        }),
      ]);
      expect(await prisma.setting.count()).toBe(3 + i);
    }
  });

  it('un create anidado que viola una unicidad deshace TODO y lanza P2002 (el código que usan users y setup)', async () => {
    await prisma.user.create({
      data: { email: 'a@fixture.invalid', displayName: 'A', passwordHash: 'x' },
    });
    const intento = prisma.user.create({
      data: {
        email: 'a@fixture.invalid',
        displayName: 'Duplicado',
        passwordHash: 'x',
        apiTokens: {
          create: { name: 't', tokenHash: 'h', prefix: 'p', scopes: '[]', role: 'viewer' },
        },
      },
    });
    await expect(intento).rejects.toSatisfy(
      (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002',
    );
    expect(await prisma.apiToken.count()).toBe(0);
  });

  it('las claves foráneas están activas: borrar un usuario arrastra sus passkeys (ON DELETE CASCADE)', async () => {
    const u = await prisma.user.create({
      data: { email: 'b@fixture.invalid', displayName: 'B', passwordHash: 'x' },
    });
    await prisma.webAuthnCredential.create({
      data: {
        userId: u.id,
        credentialId: 'c1',
        publicKey: new Uint8Array([1, 2, 3]),
        deviceType: 'singleDevice',
        name: 'k',
      },
    });
    await prisma.user.delete({ where: { id: u.id } });
    expect(await prisma.webAuthnCredential.count()).toBe(0);
  });

  it('`Bytes` hace ida y vuelta como Uint8Array', async () => {
    const u = await prisma.user.create({
      data: { email: 'c@fixture.invalid', displayName: 'C', passwordHash: 'x' },
    });
    const bytes = new Uint8Array([0, 255, 16, 0, 128, 127]);
    await prisma.webAuthnCredential.create({
      data: {
        userId: u.id,
        credentialId: 'c2',
        publicKey: bytes,
        deviceType: 'singleDevice',
        name: 'k',
      },
    });
    const leida = await prisma.webAuthnCredential.findUniqueOrThrow({
      where: { credentialId: 'c2' },
    });
    expect(leida.publicKey).toBeInstanceOf(Uint8Array);
    expect([...leida.publicKey]).toEqual([...bytes]);
  });

  it('aplica los PRAGMAs sobre la conexión del adaptador: de `delete` a `wal` (la transición)', async () => {
    const modo = async () =>
      (await prisma.$queryRawUnsafe<{ journal_mode: string }[]>('PRAGMA journal_mode'))[0]
        ?.journal_mode;
    // Base recién migrada por el aplicador: sin WAL (ese modo lo fija el cliente al arrancar).
    expect(await modo()).toBe('delete');

    const fallidos = await applySqlitePragmas(prisma);
    expect(fallidos).toEqual([]);

    expect(await modo()).toBe('wal');
    const sync =
      await prisma.$queryRawUnsafe<{ synchronous: number | bigint }[]>('PRAGMA synchronous');
    expect(Number(sync[0]?.synchronous)).toBe(1);
    const busy =
      await prisma.$queryRawUnsafe<{ timeout: number | bigint }[]>('PRAGMA busy_timeout');
    expect(Number(busy[0]?.timeout)).toBe(5000);
    const fk =
      await prisma.$queryRawUnsafe<{ foreign_keys: number | bigint }[]>('PRAGMA foreign_keys');
    expect(Number(fk[0]?.foreign_keys)).toBe(1);
  });
});

describe('resolveDbFile (US-276)', () => {
  it('una ruta relativa cuelga de `prisma/`, como con Prisma 5 (no del cwd)', () => {
    expect(resolveDbFile('file:./dev.db')).toBe(resolve('prisma', './dev.db'));
    expect(resolveDbFile('file:dev.db')).toBe(resolve('prisma', 'dev.db'));
  });

  it('una absoluta se respeta tal cual y se descarta cualquier ?query de Prisma 5', () => {
    expect(resolveDbFile('file:/data/app.db')).toBe('/data/app.db');
    expect(resolveDbFile('file:/data/app.db?connection_limit=1')).toBe('/data/app.db');
  });
});
