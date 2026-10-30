import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { assertNoSecrets, pruneNodeModules, pruneUnreachable } from '../../../../scripts/package/prune.mjs';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { collectThirdPartyLicenses } from '../../../../scripts/package/licenses.mjs';
import { afterEach, describe, expect, it } from 'vitest';
// El @ts-expect-error solo cubre la linea siguiente: sin prettier-ignore Prettier parte el import
// en varias lineas y el error de tipos queda fuera de su alcance.
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { NODE_VERSION, resolveTarget } from '../../../../scripts/package/target.mjs';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { NODE_KEYRING, assertSha256, expectedSha256, verifySignature } from '../../../../scripts/package/node-runtime.mjs';

/**
 * US-284 — funciones puras del empaquetado (`pnpm package`): destino por plataforma y
 * verificación del Node que viaja dentro de la carpeta.
 */

describe('resolveTarget', () => {
  it('Windows x64: zip y node.exe', () => {
    expect(NODE_VERSION).toBe('24.21.0');
    expect(resolveTarget('win32', 'x64')).toEqual({
      id: 'win-x64',
      nodeArchive: 'node-v24.21.0-win-x64.zip',
      nodeBin: 'node/node.exe',
      launcher: 'krakenos.cmd',
    });
  });

  it('Linux x64 y arm64: tar.xz y bin/node', () => {
    expect(resolveTarget('linux', 'x64')).toMatchObject({
      id: 'linux-x64',
      nodeArchive: 'node-v24.21.0-linux-x64.tar.xz',
      nodeBin: 'node/bin/node',
      launcher: 'bin/krakenos',
    });
    expect(resolveTarget('linux', 'arm64').nodeArchive).toBe('node-v24.21.0-linux-arm64.tar.xz');
  });

  it('una plataforma sin soporte lanza nombrándola', () => {
    expect(() => resolveTarget('darwin', 'arm64')).toThrow(/darwin/);
    expect(() => resolveTarget('win32', 'arm64')).toThrow(/win32/);
  });
});

describe('expectedSha256', () => {
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  const c = 'c'.repeat(64);
  const texto = `${a}  node-v1-linux-x64.tar.xz\n${b}  node-v1-win-x64.zip\n${c}  node-v1-linux-arm64.tar.xz\n`;

  it('devuelve la suma del fichero pedido', () => {
    expect(expectedSha256(texto, 'node-v1-win-x64.zip')).toBe(b);
  });

  it('lanza si el fichero no aparece', () => {
    expect(() => expectedSha256(texto, 'node-v1-aix-ppc64.tar.xz')).toThrow(/node-v1-aix-ppc64/);
  });

  it('lanza si el fichero aparece dos veces', () => {
    expect(() =>
      expectedSha256(`${texto}${c}  node-v1-win-x64.zip\n`, 'node-v1-win-x64.zip'),
    ).toThrow(/node-v1-win-x64\.zip/);
  });
});

describe('assertSha256', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('pasa con la suma real y lanza con otra nombrando las dos', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pkg-sha-'));
    const f = join(dir, 'x.bin');
    writeFileSync(f, 'contenido');
    const real = createHash('sha256').update('contenido').digest('hex');
    await expect(assertSha256(f, real)).resolves.toBeUndefined();
    const otra = '0'.repeat(64);
    await expect(assertSha256(f, otra)).rejects.toThrow(
      new RegExp(`${otra}[\\s\\S]*${real}|${real}[\\s\\S]*${otra}`),
    );
  });
});

describe('verifySignature', () => {
  it('llama a gpgv con ./keyring y cwd = dir, y resuelve con code 0', async () => {
    const llamadas: Array<[string, string[], { cwd: string }]> = [];
    await verifySignature({
      run: async (cmd: string, args: string[], opts: { cwd: string }) => {
        llamadas.push([cmd, args, opts]);
        return { code: 0, stderr: 'gpg: WARNING: not certified' };
      },
      dir: '/cache/node',
      keyring: 'pubring.kbx',
      signature: 'SHASUMS256.txt.sig',
      file: 'SHASUMS256.txt',
    });
    expect(llamadas).toEqual([
      [
        'gpgv',
        ['--keyring', './pubring.kbx', 'SHASUMS256.txt.sig', 'SHASUMS256.txt'],
        { cwd: '/cache/node' },
      ],
    ]);
  });

  it('lanza con code distinto de 0', async () => {
    await expect(
      verifySignature({
        run: async () => ({ code: 1, stderr: 'BAD signature' }),
        dir: 'd',
        keyring: 'k',
        signature: 's',
        file: 'f',
      }),
    ).rejects.toThrow(/BAD signature/);
  });

  it.each([
    ['keyring', 'sub/pubring.kbx'],
    ['signature', 'C:\\x\\SHASUMS256.txt.sig'],
    ['file', '../SHASUMS256.txt'],
  ])('lanza si %s trae un separador de ruta', async (campo, valor) => {
    let llamado = false;
    const opts = {
      run: async () => {
        llamado = true;
        return { code: 0, stderr: '' };
      },
      dir: 'd',
      keyring: 'k',
      signature: 's',
      file: 'f',
      [campo]: valor,
    };
    await expect(verifySignature(opts)).rejects.toThrow(/nombre de archivo/);
    expect(llamado).toBe(false);
  });
});

describe('NODE_KEYRING', () => {
  it('apunta a un commit fijado y trae una suma sha256', () => {
    expect(NODE_KEYRING.url).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/nodejs\/release-keys\/[0-9a-f]{40}\//,
    );
    expect(NODE_KEYRING.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});

function fichero(ruta: string, contenido = 'x'): void {
  mkdirSync(join(ruta, '..'), { recursive: true });
  writeFileSync(ruta, contenido);
}

describe('pruneNodeModules', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const BASES = ['postgresql', 'mysql', 'sqlserver', 'cockroachdb'];
  const VARIANTES = ['fast', 'small'];
  const EXTS = ['js', 'mjs', 'wasm-base64.js', 'wasm-base64.mjs'];

  function arbol(conSqlite: boolean): string {
    dir = mkdtempSync(join(tmpdir(), 'pkg-prune-'));
    const runtime = join(dir, '.pnpm/@prisma+client@7.10.0/node_modules/@prisma/client/runtime');
    for (const db of [...BASES, ...(conSqlite ? ['sqlite'] : [])])
      for (const v of VARIANTES)
        for (const e of EXTS) fichero(join(runtime, `query_compiler_${v}_bg.${db}.${e}`));
    fichero(join(runtime, 'client.js'));
    fichero(join(dir, 'prisma/package.json'), '{}');
    fichero(join(dir, '.pnpm/prisma@7.10.0/node_modules/prisma/x.js'));
    return runtime;
  }

  it('borra los WASM de otras bases y la CLI prisma; conserva SQLite y client', async () => {
    const runtime = arbol(true);
    const r = await pruneNodeModules(dir);
    expect(existsSync(join(runtime, 'query_compiler_fast_bg.postgresql.mjs'))).toBe(false);
    expect(existsSync(join(runtime, 'query_compiler_small_bg.cockroachdb.wasm-base64.js'))).toBe(
      false,
    );
    expect(existsSync(join(runtime, 'query_compiler_fast_bg.sqlite.wasm-base64.mjs'))).toBe(true);
    expect(existsSync(join(runtime, 'client.js'))).toBe(true);
    expect(existsSync(join(dir, 'prisma'))).toBe(false);
    expect(existsSync(join(dir, '.pnpm/prisma@7.10.0'))).toBe(false);
    expect(r.removed.length).toBeGreaterThanOrEqual(32);
    expect(r.freedBytes).toBeGreaterThan(0);
  });

  it('falla cerrado si no hay WASM de SQLite', async () => {
    arbol(false);
    await expect(pruneNodeModules(dir)).rejects.toThrow(/sqlite/i);
  });
});

describe('pruneUnreachable', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('borra solo lo que ningun symlink alcanza, siguiendo la cadena transitiva', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pkg-reach-'));
    const pnpm = join(dir, '.pnpm');
    for (const n of ['a@1', 'b@1', 'huerfano@1', '@s+c@1']) {
      mkdirSync(join(pnpm, n, 'node_modules', n.split('@')[0] || '@s'), { recursive: true });
    }
    mkdirSync(join(pnpm, '@s+c@1/node_modules/@s/c'), { recursive: true });
    mkdirSync(join(pnpm, 'node_modules'), { recursive: true });
    writeFileSync(join(pnpm, 'lock.yaml'), '');
    // node_modules/a -> a@1 ; a@1 depende de b (hermano en su node_modules)
    symlinkSync(join(pnpm, 'a@1/node_modules/a'), join(dir, 'a'));
    symlinkSync(join(pnpm, 'b@1/node_modules/b'), join(pnpm, 'a@1/node_modules/b'));
    mkdirSync(join(dir, '@s'));
    symlinkSync(join(pnpm, '@s+c@1/node_modules/@s/c'), join(dir, '@s/c'));
    const r = await pruneUnreachable(dir);
    expect(r.removed).toEqual(['huerfano@1']);
    expect(existsSync(join(pnpm, 'a@1'))).toBe(true);
    expect(existsSync(join(pnpm, 'b@1'))).toBe(true);
    expect(existsSync(join(pnpm, '@s+c@1'))).toBe(true);
    expect(existsSync(join(pnpm, 'huerfano@1'))).toBe(false);
    expect(existsSync(join(pnpm, 'lock.yaml'))).toBe(true);
    expect(existsSync(join(pnpm, 'node_modules'))).toBe(true);
  });
});

describe('assertNoSecrets', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const nuevo = () => (dir = mkdtempSync(join(tmpdir(), 'pkg-sec-')));

  it('lanza nombrando la ruta con una clave pem', async () => {
    nuevo();
    fichero(join(dir, 'app/agent/keys/jwt-private.pem'));
    await expect(assertNoSecrets(dir)).rejects.toThrow(/app[\\/]agent[\\/]keys/);
  });

  it('lanza con .env, con src/ y con una base .db', async () => {
    nuevo();
    fichero(join(dir, 'app/agent/.env'));
    await expect(assertNoSecrets(dir)).rejects.toThrow(/\.env/);
    rmSync(join(dir, 'app/agent/.env'));
    fichero(join(dir, 'app/agent/src/index.ts'));
    await expect(assertNoSecrets(dir)).rejects.toThrow(/src/);
    rmSync(join(dir, 'app/agent/src'), { recursive: true });
    fichero(join(dir, 'app/agent/node_modules/x/dev.db'));
    await expect(assertNoSecrets(dir)).rejects.toThrow(/dev\.db/);
  });

  it('lanza con secretbox.key suelto', async () => {
    nuevo();
    fichero(join(dir, 'app/agent/otro/secretbox.key'));
    await expect(assertNoSecrets(dir)).rejects.toThrow(/secretbox\.key/);
  });

  it('pasa con solo .env.example', async () => {
    nuevo();
    fichero(join(dir, 'app/agent/.env.example'));
    fichero(join(dir, 'app/agent/dist/index.js'));
    await expect(assertNoSecrets(dir)).resolves.toBeUndefined();
  });
});

describe('collectThirdPartyLicenses', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lista nombre@version, licencia y texto, ordenado por nombre', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pkg-lic-'));
    const pnpm = join(dir, '.pnpm');
    const crea = (carpeta: string, nombre: string, extra: object, lic?: string) => {
      const p = join(pnpm, carpeta, 'node_modules', nombre);
      fichero(join(p, 'package.json'), JSON.stringify({ name: nombre, ...extra }));
      if (lic) fichero(join(p, 'LICENSE'), lic);
    };
    crea('zeta@2.0.0', 'zeta', { version: '2.0.0', license: 'ISC' });
    crea('alfa@1.0.0', 'alfa', { version: '1.0.0', license: 'MIT' }, 'Copyright Alfa Texto');
    const texto = await collectThirdPartyLicenses(dir);
    expect(texto).toContain('alfa@1.0.0');
    expect(texto).toContain('zeta@2.0.0');
    expect(texto).toContain('MIT');
    expect(texto).toContain('ISC');
    expect(texto).toContain('Copyright Alfa Texto');
    expect(texto.indexOf('alfa@1.0.0')).toBeLessThan(texto.indexOf('zeta@2.0.0'));
  });
});
