import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  decryptArchive,
  decryptArchiveAsync,
  unpackArchive,
} from '../../src/system/backup.js';
import { BackupService } from '../../src/system/backup.service.js';

/**
 * Copia de seguridad **por streaming** (US-233 / AUD3-15).
 *
 * Antes se mantenían ~3 copias completas de la base en RAM (snapshot +
 * empaquetado + ciphertext): pico proyectado de ~1,8 GB de RSS en una máquina cuyo
 * mínimo declarado son 900 MB. Ahora se escribe a un fichero por trozos, así que el
 * riesgo se traslada a los **límites de trozo**: es lo que atan estos tests, junto a
 * la compatibilidad de formato (un archivo nuevo debe abrirse con el descifrado de
 * siempre, o los backups viejos y nuevos dejarían de ser intercambiables).
 */

const PASS = 'copia-larga-1';

function sandbox(): { keysDir: string; dataDir: string; out: string } {
  const root = mkdtempSync(join(tmpdir(), 'krakenos-bak-test-'));
  const keysDir = join(root, 'keys');
  const dataDir = join(root, 'data');
  mkdirSync(keysDir);
  mkdirSync(dataDir);
  return { keysDir, dataDir, out: join(root, 'out', 'backup.kbk') };
}

/**
 * Prisma falso: `VACUUM INTO '<ruta>'` escribe un fichero con cabecera SQLite en la
 * ruta pedida, igual que haría SQLite.
 */
function fakePrisma(dbBody: Buffer): PrismaClient {
  return {
    $executeRawUnsafe: async (sql: string) => {
      const path = /VACUUM INTO '(.+)'$/.exec(sql)?.[1];
      if (!path) throw new Error(`SQL inesperado: ${sql}`);
      writeFileSync(path, Buffer.concat([Buffer.from('SQLite format 3\0'), dbBody]));
      return 0;
    },
  } as unknown as PrismaClient;
}

describe('BackupService.createToFile (US-233)', () => {
  it('escribe un archivo restaurable con la DB, keys y data', async () => {
    const { keysDir, dataDir, out } = sandbox();
    writeFileSync(join(keysDir, 'secretbox.key'), 'CLAVE-SECRETBOX');
    writeFileSync(join(dataDir, 'cameras.json'), '[{"rtspUrl":"rtsp://x"}]');
    const service = new BackupService(fakePrisma(Buffer.from('CUERPO-DB')), { keysDir, dataDir });

    const result = await service.createToFile(PASS, out);
    expect(result.path).toBe(out);
    expect(result.bytes).toBeGreaterThan(0);
    expect(statSync(out).size).toBe(result.bytes);

    const entries = unpackArchive(await decryptArchiveAsync(readFileSync(out), PASS));
    const names = entries.map((e) => e.name).sort();
    expect(names).toEqual(['data/cameras.json', 'db/app.db', 'keys/secretbox.key']);
    expect(entries.find((e) => e.name === 'keys/secretbox.key')!.data.toString()).toBe(
      'CLAVE-SECRETBOX',
    );
    expect(
      entries.find((e) => e.name === 'db/app.db')!.data.subarray(0, 16).toString('utf8'),
    ).toContain('SQLite format 3');
  });

  // El troceado es donde se rompen los escritores incrementales: un fichero más
  // grande que el trozo de lectura (4 MiB) cruza varios `update()`.
  it('respeta los límites de trozo con ficheros grandes y vacíos', async () => {
    const { keysDir, dataDir, out } = sandbox();
    // 10 MiB de bytes NO uniformes: un fallo de orden o de solape se ve al comparar.
    const big = Buffer.alloc(10 * 1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    writeFileSync(join(dataDir, 'grande.bin'), big);
    writeFileSync(join(dataDir, 'vacio.json'), '');
    const service = new BackupService(fakePrisma(Buffer.alloc(5 * 1024 * 1024, 7)), {
      keysDir,
      dataDir,
    });

    await service.createToFile(PASS, out);
    const entries = unpackArchive(await decryptArchiveAsync(readFileSync(out), PASS));
    const restored = entries.find((e) => e.name === 'data/grande.bin')!.data;
    expect(restored.length).toBe(big.length);
    expect(restored.equals(big)).toBe(true);
    expect(entries.find((e) => e.name === 'data/vacio.json')!.data.length).toBe(0);
  });

  it('el archivo escrito por streaming se abre con el descifrado síncrono (mismo formato)', async () => {
    const { keysDir, dataDir, out } = sandbox();
    writeFileSync(join(keysDir, 'jwt-private.pem'), 'PEM');
    const service = new BackupService(fakePrisma(Buffer.from('X')), { keysDir, dataDir });
    await service.createToFile(PASS, out);

    // Ruta síncrona (la que usan los tests de formato y cualquier herramienta externa).
    const entries = unpackArchive(decryptArchive(readFileSync(out), PASS));
    expect(entries.map((e) => e.name)).toContain('keys/jwt-private.pem');
    // Y con la contraseña equivocada no se abre.
    expect(() => decryptArchive(readFileSync(out), 'contrasena-mala')).toThrow();
  });

  it('el archivo nace con permisos 600 (contiene las claves del sistema)', async () => {
    const { keysDir, dataDir, out } = sandbox();
    const service = new BackupService(fakePrisma(Buffer.from('X')), { keysDir, dataDir });
    await service.createToFile(PASS, out);
    expect(statSync(out).mode & 0o777).toBe(0o600);
  });

  it('una passphrase corta no escribe ningún archivo', async () => {
    const { keysDir, dataDir, out } = sandbox();
    const service = new BackupService(fakePrisma(Buffer.from('X')), { keysDir, dataDir });
    await expect(service.createToFile('corta', out)).rejects.toThrow(/al menos/i);
    expect(existsSync(out)).toBe(false);
  });

  it('si falla a media escritura no deja un archivo a medias', async () => {
    const { keysDir, dataDir, out } = sandbox();
    writeFileSync(join(dataDir, 'ok.json'), '{}');
    const service = new BackupService(
      {
        $executeRawUnsafe: async (sql: string) => {
          const path = /VACUUM INTO '(.+)'$/.exec(sql)?.[1];
          writeFileSync(path!, 'DB');
          return 0;
        },
      } as unknown as PrismaClient,
      { keysDir, dataDir },
    );
    // Se borra el fichero justo tras medir su tamaño → el stream falla a mitad.
    const original = service['snapshotDbToFile'].bind(service);
    (service as unknown as { snapshotDbToFile: unknown }).snapshotDbToFile = async (dir: string) => {
      const entry = (await original(dir)) as { name: string; path: string; size: number };
      return { ...entry, path: join(dir, 'no-existe.db') };
    };
    await expect(service.createToFile(PASS, out)).rejects.toThrow();
    expect(existsSync(out)).toBe(false);
  });
});

describe('nombres de archivo de copia', () => {
  it('el nombre ordena igual cronológica y alfabéticamente', () => {
    const older = BackupService.fileNameFor(new Date('2026-07-28T23:00:00.000Z'));
    const newer = BackupService.fileNameFor(new Date('2026-07-29T03:00:00.000Z'));
    expect([newer, older].sort()).toEqual([older, newer]);
    expect(newer).toMatch(/^krakenos-backup-.*\.kbk$/);
  });

  it('reconoce solo los nombres que genera KrakenOS (la poda no toca ficheros ajenos)', () => {
    expect(BackupService.isBackupFileName(BackupService.fileNameFor(new Date()))).toBe(true);
    for (const alien of ['mi-copia.kbk', 'krakenos-backup.tar', 'notas.txt', '.env']) {
      expect(BackupService.isBackupFileName(alien), alien).toBe(false);
    }
  });
});
