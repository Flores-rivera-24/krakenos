import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { KEEP_BACKUPS } from '../../src/db/migrate.js';
import { keyFilePaths } from '../../src/system/key-paths.js';
import {
  applyStagedRestore,
  pruneRestoreBackups,
  type RestoreTargets,
} from '../../src/system/restore.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kr-poda-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const stamp = (i: number): string => `2026-01-${String(i + 1).padStart(2, '0')}T10-00-00-000Z`;
const sembrar = (prefijo: string, n: number): string[] =>
  Array.from({ length: n }, (_, i) => {
    const nombre = `${prefijo}-${stamp(i)}`;
    mkdirSync(join(dir, nombre), { recursive: true });
    return nombre;
  });

describe('poda de los respaldos de una restauración', () => {
  for (const prefijo of ['pre-restore', 'restore-failed']) {
    it(`${prefijo}: tras N+2 restauraciones quedan las N más recientes`, () => {
      const todos = sembrar(prefijo, KEEP_BACKUPS + 2);
      pruneRestoreBackups(dir);
      expect(readdirSync(dir).sort()).toEqual(todos.slice(2));
    });
  }

  it('lo que no casa con el patrón, y el resto de prefijos, no se toca', () => {
    sembrar('pre-restore', KEEP_BACKUPS + 2);
    const ajenos = ['pre-restore-X', 'pre-restore', 'restore-staging', 'pre-migrate-2026-01-01.db'];
    for (const a of ajenos) mkdirSync(join(dir, a));
    pruneRestoreBackups(dir);
    for (const a of ajenos) expect(existsSync(join(dir, a))).toBe(true);
  });

  it('cada prefijo se poda por separado', () => {
    sembrar('pre-restore', KEEP_BACKUPS + 1);
    const fallidos = sembrar('restore-failed', 1);
    pruneRestoreBackups(dir);
    expect(readdirSync(dir).filter((n) => n.startsWith('restore-failed'))).toEqual(fallidos);
    expect(readdirSync(dir).filter((n) => n.startsWith('pre-restore'))).toHaveLength(KEEP_BACKUPS);
  });

  it.skipIf(process.platform === 'win32')('el respaldo nace 0700 y sus ficheros 0600', () => {
    const staging = join(dir, 'staging');
    mkdirSync(join(staging, 'data'), { recursive: true });
    writeFileSync(join(staging, 'data/a.json'), 'nuevo');
    const dataDir = join(dir, 'data');
    mkdirSync(dataDir);
    writeFileSync(join(dataDir, 'a.json'), 'viejo', { mode: 0o644 });
    const targets: RestoreTargets = {
      dbFile: join(dir, 'app.db'),
      keysDir: join(dir, 'keys'),
      keyFiles: keyFilePaths({
        jwtPrivateKeyPath: join(dir, 'keys', 'jwt-private.pem'),
        jwtPublicKeyPath: join(dir, 'keys', 'jwt-public.pem'),
        secretboxKeyPath: join(dir, 'keys', 'secretbox.key'),
      }),
      dataDir,
    };
    const pre = join(dir, `pre-restore-${stamp(0)}`);
    applyStagedRestore(staging, targets, pre);
    expect(statSync(pre).mode & 0o777).toBe(0o700);
    expect(statSync(join(pre, 'data')).mode & 0o777).toBe(0o700);
    expect(statSync(join(pre, 'data/a.json')).mode & 0o777).toBe(0o600);
  });
});
