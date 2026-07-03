import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { encryptArchive, packArchive, type ArchiveEntry } from '../../src/system/backup.js';
import { applyStagedRestore, resolveDbFile, stageRestore } from '../../src/system/restore.js';

const PASS = 'passphrase-larga';
const makeBackup = (entries: ArchiveEntry[]) => encryptArchive(packArchive(entries), PASS);

describe('restore (US-104)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'kr-restore-'));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('stage: escribe los ficheros del backup en staging', () => {
    const blob = makeBackup([
      { name: 'db/app.db', data: Buffer.from('DBDATA') },
      { name: 'keys/secretbox.key', data: Buffer.from([1, 2, 3]) },
      { name: 'data/wg-peers.json', data: Buffer.from('[]') },
    ]);
    const staging = join(tmp, 'staging');
    const names = stageRestore(blob, PASS, staging);
    expect(names.sort()).toEqual(['data/wg-peers.json', 'db/app.db', 'keys/secretbox.key']);
    expect(readFileSync(join(staging, 'db/app.db')).toString()).toBe('DBDATA');
  });

  it('stage: RECHAZA path traversal (zip-slip)', () => {
    const blob = makeBackup([
      { name: 'db/app.db', data: Buffer.from('X') },
      { name: '../evil', data: Buffer.from('pwn') },
    ]);
    expect(() => stageRestore(blob, PASS, join(tmp, 's'))).toThrow(/no válida/i);
    // Y no debe haber escrito nada fuera.
    expect(existsSync(join(tmp, 'evil'))).toBe(false);
  });

  it('stage: exige que el backup contenga la base de datos', () => {
    const blob = makeBackup([{ name: 'keys/x', data: Buffer.from('k') }]);
    expect(() => stageRestore(blob, PASS, join(tmp, 's'))).toThrow(/base de datos/i);
  });

  it('stage: passphrase incorrecta lanza', () => {
    const blob = makeBackup([{ name: 'db/app.db', data: Buffer.from('X') }]);
    expect(() => stageRestore(blob, 'otra-distinta', join(tmp, 's'))).toThrow();
  });

  it('apply: coloca los ficheros y respalda lo anterior; borra el staging', () => {
    const staging = join(tmp, 'staging');
    stageRestore(
      makeBackup([
        { name: 'db/app.db', data: Buffer.from('NUEVA-DB') },
        { name: 'keys/secretbox.key', data: Buffer.from('NUEVA-KEY') },
      ]),
      PASS,
      staging,
    );

    const dbFile = join(tmp, 'live/dev.db');
    const keysDir = join(tmp, 'live/keys');
    const dataDir = join(tmp, 'live/data');
    mkdirSync(dirname(dbFile), { recursive: true });
    writeFileSync(dbFile, 'VIEJA-DB'); // preexistente → debe respaldarse
    const pre = join(tmp, 'pre');

    const applied = applyStagedRestore(staging, { dbFile, keysDir, dataDir }, pre);
    expect(applied.sort()).toEqual(['db/app.db', 'keys/secretbox.key']);
    expect(readFileSync(dbFile).toString()).toBe('NUEVA-DB');
    expect(readFileSync(join(keysDir, 'secretbox.key')).toString()).toBe('NUEVA-KEY');
    expect(readFileSync(join(pre, 'db/app.db')).toString()).toBe('VIEJA-DB');
    expect(existsSync(staging)).toBe(false);
  });

  it('resolveDbFile: file: relativo → prisma/, absoluto → tal cual', () => {
    expect(resolveDbFile('file:./dev.db')).toMatch(/prisma[/\\]dev\.db$/);
    expect(resolveDbFile('file:/var/lib/krakenos/app.db')).toBe('/var/lib/krakenos/app.db');
  });
});
