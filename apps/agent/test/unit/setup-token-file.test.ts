import { mkdtempSync, writeFileSync, readFileSync, statSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolvePaths } from '../../src/config/paths.js';
import { removeSetupTokenFile, writeSetupTokenFile } from '../../src/modules/setup/setup-token.js';

const posix = process.platform === 'win32' ? it.skip : it;
const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'krakenos-setup-token-'));
  dirs.push(d);
  return join(d, 'setup-token');
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('fichero del token de setup', () => {
  posix('escribe el token con permisos 0600', async () => {
    const f = tmp();
    await writeSetupTokenFile(f, 'abc');
    expect(readFileSync(f, 'utf8')).toBe('abc\n');
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });

  posix('reescribe un fichero previo y le quita permisos de más', async () => {
    const f = tmp();
    writeFileSync(f, 'viejo\n');
    chmodSync(f, 0o644);
    await writeSetupTokenFile(f, 'nuevo');
    expect(readFileSync(f, 'utf8')).toBe('nuevo\n');
    expect(statSync(f).mode & 0o777).toBe(0o600);
  });

  it('borrar un fichero que no existe no falla', async () => {
    await expect(removeSetupTokenFile(tmp())).resolves.toBeUndefined();
  });

  it('resolvePaths da setupTokenFile bajo KRAKENOS_DATA_DIR', () => {
    const p = resolvePaths({ KRAKENOS_DATA_DIR: '/srv/k' }, '/cwd');
    expect(p.setupTokenFile).toBe(resolve('/srv/k', 'setup-token'));
  });
});
