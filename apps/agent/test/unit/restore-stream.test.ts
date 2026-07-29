import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encryptArchive, packArchive, type ArchiveEntry } from '../../src/system/backup.js';
import { stageRestoreFromFileAsync } from '../../src/system/restore.js';

/**
 * Restauración por **streaming** (US-233 / AUD3-15).
 *
 * El fallo que ata: la ruta anterior recibía el archivo en **base64** dentro de un
 * JSON con `bodyLimit` de 64 MB (≈48 MB reales) mientras la creación no tenía tope
 * → se podía crear un backup **más grande de lo que se podía restaurar**.
 *
 * Y la propiedad de seguridad que hay que no romper nunca: GCM solo autentica en
 * `final()`, así que el texto claro que sale por el camino no está verificado. Nada
 * puede aparecer en el staging definitivo si el archivo no autentica.
 */

const PASS = 'restaurar-larga-1';

function sandbox(): { dir: string; archive: string; staging: string } {
  const dir = mkdtempSync(join(tmpdir(), 'krakenos-restore-'));
  return { dir, archive: join(dir, 'copia.kbk'), staging: join(dir, 'staging') };
}

function writeArchive(path: string, entries: ArchiveEntry[], pass = PASS): void {
  writeFileSync(path, encryptArchive(packArchive(entries), pass));
}

const DB: ArchiveEntry = { name: 'db/app.db', data: Buffer.from('SQLite format 3\0datos') };

describe('stageRestoreFromFileAsync (US-233)', () => {
  it('prepara el staging leyendo el archivo de disco', async () => {
    const { archive, staging } = sandbox();
    writeArchive(archive, [
      DB,
      { name: 'keys/secretbox.key', data: Buffer.from('CLAVE') },
      { name: 'data/cameras.json', data: Buffer.from('[]') },
    ]);

    const staged = await stageRestoreFromFileAsync(archive, PASS, staging);
    expect(staged.sort()).toEqual(['data/cameras.json', 'db/app.db', 'keys/secretbox.key']);
    expect(readFileSync(join(staging, 'keys/secretbox.key'), 'utf8')).toBe('CLAVE');
    expect(readFileSync(join(staging, 'db/app.db')).equals(DB.data)).toBe(true);
  });

  it('restaura ficheros grandes (varios trozos) byte a byte', async () => {
    const { archive, staging } = sandbox();
    const big = Buffer.alloc(9 * 1024 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = (i * 7) % 253;
    writeArchive(archive, [DB, { name: 'data/grande.bin', data: big }]);

    await stageRestoreFromFileAsync(archive, PASS, staging);
    expect(readFileSync(join(staging, 'data/grande.bin')).equals(big)).toBe(true);
  });

  it('restaura una entrada vacía como fichero vacío (no la pierde)', async () => {
    const { archive, staging } = sandbox();
    writeArchive(archive, [DB, { name: 'data/vacio.json', data: Buffer.alloc(0) }]);
    await stageRestoreFromFileAsync(archive, PASS, staging);
    expect(existsSync(join(staging, 'data/vacio.json'))).toBe(true);
    expect(readFileSync(join(staging, 'data/vacio.json')).length).toBe(0);
  });

  // La propiedad de seguridad: sin autenticación, nada se publica.
  it('con la passphrase incorrecta no deja NADA en el staging', async () => {
    const { archive, staging } = sandbox();
    writeArchive(archive, [DB, { name: 'keys/secretbox.key', data: Buffer.from('CLAVE') }]);
    await expect(stageRestoreFromFileAsync(archive, 'otra-passphrase-1', staging)).rejects.toThrow();
    expect(existsSync(staging)).toBe(false);
    expect(existsSync(`${staging}.incoming`)).toBe(false);
  });

  it('un archivo MANIPULADO (tag GCM que no cuadra) no publica nada', async () => {
    const { archive, staging } = sandbox();
    writeArchive(archive, [DB, { name: 'data/algo.json', data: Buffer.alloc(1024, 65) }]);
    // Toca un byte del ciphertext: descifra a basura pero el tag ya no cuadrará.
    const blob = readFileSync(archive);
    blob[blob.length - 10] = blob[blob.length - 10]! ^ 0xff;
    writeFileSync(archive, blob);

    await expect(stageRestoreFromFileAsync(archive, PASS, staging)).rejects.toThrow(
      /contraseña incorrecta o backup dañado/i,
    );
    expect(existsSync(staging)).toBe(false);
    expect(existsSync(`${staging}.incoming`)).toBe(false);
  });

  it('rechaza rutas fuera del árbol previsto ANTES de escribir (path traversal)', async () => {
    const { archive, staging } = sandbox();
    writeArchive(archive, [DB, { name: 'keys/../../evil', data: Buffer.from('X') }]);
    await expect(stageRestoreFromFileAsync(archive, PASS, staging)).rejects.toThrow(
      /ruta no válida/i,
    );
    expect(existsSync(staging)).toBe(false);
  });

  it('exige que el archivo contenga la base de datos', async () => {
    const { archive, staging } = sandbox();
    writeArchive(archive, [{ name: 'keys/solo.key', data: Buffer.from('X') }]);
    await expect(stageRestoreFromFileAsync(archive, PASS, staging)).rejects.toThrow(
      /no contiene la base de datos/i,
    );
  });

  it('un archivo truncado se detecta en vez de dejar el staging a medias', async () => {
    const { archive, staging } = sandbox();
    writeArchive(archive, [DB, { name: 'data/algo.json', data: Buffer.alloc(4096, 66) }]);
    const blob = readFileSync(archive);
    writeFileSync(archive, blob.subarray(0, blob.length - 2048));
    await expect(stageRestoreFromFileAsync(archive, PASS, staging)).rejects.toThrow();
    expect(existsSync(staging)).toBe(false);
  });

  it('un fichero que no es un backup se rechaza sin tocar el staging', async () => {
    const { archive, staging } = sandbox();
    writeFileSync(archive, Buffer.from('esto no es un backup, para nada, de verdad'));
    await expect(stageRestoreFromFileAsync(archive, PASS, staging)).rejects.toThrow(
      /no reconocido/i,
    );
    expect(existsSync(staging)).toBe(false);
  });

  it('reemplaza un staging anterior (una restauración nueva manda)', async () => {
    const { archive, staging } = sandbox();
    mkdirSync(join(staging, 'db'), { recursive: true });
    writeFileSync(join(staging, 'db/app.db'), 'RESTO-VIEJO');
    writeFileSync(join(staging, 'db/sobra.db'), 'SOBRA');
    writeArchive(archive, [DB]);

    await stageRestoreFromFileAsync(archive, PASS, staging);
    expect(readFileSync(join(staging, 'db/app.db')).equals(DB.data)).toBe(true);
    expect(existsSync(join(staging, 'db/sobra.db'))).toBe(false);
  });
});
