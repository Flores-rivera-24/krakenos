import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { unpackArchive } from '../../src/system/backup.js';
import { decryptArchiveAsync } from '../../src/system/backup.js';
import { BackupService } from '../../src/system/backup.service.js';
import { keyFilePaths } from '../../src/system/key-paths.js';
import { applyStagedRestore, stageRestoreFromFileAsync } from '../../src/system/restore.js';

/**
 * D1: las claves viven donde las configura el entorno (en Docker, `/data/keys`), no
 * en `./keys`. La copia las lee de ahí y el restore las escribe ahí; en el archivo
 * siguen siendo los nombres lógicos `keys/<fichero>` (el formato no cambia).
 */

const PASS = 'copia-larga-1';

function fakePrisma(): PrismaClient {
  return {
    $executeRawUnsafe: async (sql: string) => {
      const path = /VACUUM INTO '(.+)'$/.exec(sql)?.[1];
      if (!path) throw new Error(`SQL inesperado: ${sql}`);
      writeFileSync(path, Buffer.from('SQLite format 3\0DB'));
      return 0;
    },
  } as unknown as PrismaClient;
}

describe('copia y restore de claves en rutas del entorno (D1)', () => {
  it('keyFilePaths resuelve las tres rutas desde el entorno', () => {
    const p = keyFilePaths({
      jwtPrivateKeyPath: '/data/keys/jwt-private.pem',
      jwtPublicKeyPath: '/data/keys/jwt-public.pem',
      secretboxKeyPath: '/data/keys/secretbox.key',
    });
    expect(p).toEqual({
      jwtPrivate: '/data/keys/jwt-private.pem',
      jwtPublic: '/data/keys/jwt-public.pem',
      secretbox: '/data/keys/secretbox.key',
    });
  });

  it('guarda y restaura byte a byte las claves en rutas distintas de ./keys', async () => {
    const root = mkdtempSync(join(tmpdir(), 'krakenos-claves-'));
    const origen = join(root, 'volumen-a', 'keys');
    mkdirSync(origen, { recursive: true });
    const bytes = {
      'jwt-private.pem': Buffer.from([1, 2, 3, 0xff, 0]),
      'jwt-public.pem': Buffer.from('PUBLICA'),
      'secretbox.key': Buffer.from([9, 8, 7, 0x80]),
    };
    for (const [n, b] of Object.entries(bytes)) writeFileSync(join(origen, n), b);
    const dataDir = join(root, 'volumen-a', 'data');
    mkdirSync(dataDir, { recursive: true });
    const keyFiles = keyFilePaths({
      jwtPrivateKeyPath: join(origen, 'jwt-private.pem'),
      jwtPublicKeyPath: join(origen, 'jwt-public.pem'),
      secretboxKeyPath: join(origen, 'secretbox.key'),
    });

    const archivo = join(root, 'out', 'b.kbk');
    await new BackupService(fakePrisma(), { keyFiles, dataDir }).createToFile(PASS, archivo);

    // Nombres lógicos: el formato del archivo no cambia.
    const nombres = unpackArchive(await decryptArchiveAsync(readFileSync(archivo), PASS))
      .map((e) => e.name)
      .sort();
    expect(nombres).toEqual(
      ['db/app.db', 'keys/jwt-private.pem', 'keys/jwt-public.pem', 'keys/secretbox.key'].sort(),
    );

    // Restaurar en un volumen NUEVO, con rutas propias.
    const destino = join(root, 'volumen-b', 'keys');
    const staging = join(root, 'staging');
    await stageRestoreFromFileAsync(archivo, PASS, staging);
    const nuevas = keyFilePaths({
      jwtPrivateKeyPath: join(destino, 'jwt-private.pem'),
      jwtPublicKeyPath: join(destino, 'jwt-public.pem'),
      secretboxKeyPath: join(destino, 'secretbox.key'),
    });
    applyStagedRestore(
      staging,
      {
        dbFile: join(root, 'volumen-b', 'app.db'),
        keysDir: join(root, 'keys-que-no-debe-usarse'),
        keyFiles: nuevas,
        dataDir: join(root, 'volumen-b', 'data'),
      },
      join(root, 'pre'),
    );
    for (const [n, b] of Object.entries(bytes)) {
      expect(readFileSync(join(destino, n)).equals(b)).toBe(true);
      // Son secretos: quedan solo para el dueño, aunque el staging se escribiera con la umask.
      expect(statSync(join(destino, n)).mode & 0o777).toBe(0o600);
    }
  });

  it('regresión: una copia con la disposición clásica (keys/ relativo) sigue restaurando', async () => {
    const root = mkdtempSync(join(tmpdir(), 'krakenos-claves-'));
    const keysDir = join(root, 'keys');
    mkdirSync(keysDir);
    writeFileSync(join(keysDir, 'secretbox.key'), 'CLAVE');
    const archivo = join(root, 'b.kbk');
    const origen = keyFilePaths({
      jwtPrivateKeyPath: join(keysDir, 'jwt-private.pem'),
      jwtPublicKeyPath: join(keysDir, 'jwt-public.pem'),
      secretboxKeyPath: join(keysDir, 'secretbox.key'),
    });
    await new BackupService(fakePrisma(), {
      keyFiles: origen,
      dataDir: join(root, 'data'),
    }).createToFile(PASS, archivo);
    const staging = join(root, 'staging');
    await stageRestoreFromFileAsync(archivo, PASS, staging);
    const vivo = join(root, 'vivo', 'keys');
    applyStagedRestore(
      staging,
      {
        dbFile: join(root, 'vivo/app.db'),
        keysDir: vivo,
        keyFiles: keyFilePaths({
          jwtPrivateKeyPath: join(vivo, 'jwt-private.pem'),
          jwtPublicKeyPath: join(vivo, 'jwt-public.pem'),
          secretboxKeyPath: join(vivo, 'secretbox.key'),
        }),
        dataDir: join(root, 'vivo/data'),
      },
      join(root, 'pre'),
    );
    expect(readFileSync(join(vivo, 'secretbox.key'), 'utf8')).toBe('CLAVE');
  });
});
