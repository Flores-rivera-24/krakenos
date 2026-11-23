import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error módulo .mjs sin tipos
import * as rl from '../../../../scripts/package/rust-licenses.mjs';

const metadata = JSON.parse(
  readFileSync(resolve(__dirname, '../fixtures/cargo-metadata-mini.json'), 'utf8'),
);

describe('crateDeEjecucion', () => {
  it('toma solo aristas normales transitivas desde la raíz y deja fuera build y dev', () => {
    const crates = rl.crateDeEjecucion(metadata, 'krakenos-window');
    expect(crates.map((c: { name: string }) => c.name).sort()).toEqual([
      'directa',
      'mozilla',
      'transitiva',
    ]);
    const d = crates.find((c: { name: string }) => c.name === 'directa');
    expect(d).toMatchObject({
      version: '1.0.0',
      license: 'MIT OR Apache-2.0',
      repository: 'https://github.com/x/directa',
      authors: ['Ana <ana@x.test>'],
      dir: dirname('/reg/directa-1.0.0/Cargo.toml'),
    });
  });

  it('falla si la raíz no existe', () => {
    expect(() => rl.crateDeEjecucion(metadata, 'nada')).toThrow(/nada/);
  });
});

describe('licenciaPermitida', () => {
  it.each([
    'MIT',
    'MIT OR Apache-2.0',
    '(MIT OR Apache-2.0) AND Unicode-3.0',
    'Apache-2.0 WITH LLVM-exception',
    'MIT/Apache-2.0',
    'MPL-2.0',
    'GPL-3.0-only OR MIT',
  ])('permite %s', (e) => expect(rl.licenciaPermitida(e, 'x')).toBe(true));

  it.each([
    'MIT Apache-2.0',
    'MIT)',
    '(MIT',
    'MIT OR',
    'MIT garbage OR GPL-3.0',
    '',
    'OR MIT',
    'MIT AND AND MIT',
    '()',
  ])('la expresión mal formada «%s» lanza nombrando expresión y crate', (e) => {
    expect(() => rl.licenciaPermitida(e, 'rota 1.0.0')).toThrow(/expresión.*rota 1\.0\.0/s);
  });

  it('AND exige todas las ramas', () => {
    expect(rl.licenciaPermitida('MIT AND Raro-1.0', 'x')).toBe(false);
  });

  it.each(['GPL-3.0-only', 'LGPL-2.1-or-later', 'MIT AND AGPL-3.0-only'])(
    '%s es decisión del dueño y nombra la crate',
    (e) => {
      expect(() => rl.licenciaPermitida(e, 'malita')).toThrow(/malita.*decisión del dueño/s);
    },
  );
});

describe('textosDeLicencia y avisoRust', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('lee LICENSE*, COPYING*, NOTICE* y el license_file declarado, literal', async () => {
    dir = mkdtempSync(join(tmpdir(), 'rust-lic-'));
    writeFileSync(join(dir, 'LICENSE-MIT'), 'texto MIT\n');
    writeFileSync(join(dir, 'license-apache'), 'texto apache');
    writeFileSync(join(dir, 'NOTICE'), 'aviso');
    writeFileSync(join(dir, 'README.md'), 'no');
    mkdirSync(join(dir, 'LICENSES'));
    writeFileSync(join(dir, 'raro.txt'), 'declarado');
    const t = await rl.textosDeLicencia(dir, 'raro.txt');
    expect(t.map((x: { fichero: string }) => x.fichero).sort()).toEqual([
      'LICENSE-MIT',
      'NOTICE',
      'license-apache',
      'raro.txt',
    ]);
    expect(t.find((x: { fichero: string }) => x.fichero === 'LICENSE-MIT').texto).toBe(
      'texto MIT\n',
    );
  });

  it('ordena por nombre y deduplica textos idénticos con referencia', () => {
    const mk = (name: string, texto: string) => ({
      name,
      version: '1.0.0',
      license: 'MIT',
      authors: ['Yo'],
      repository: `https://r/${name}`,
      textos: [{ fichero: 'LICENSE', texto }],
    });
    const out = rl.avisoRust([
      mk('zeta', 'MIT igual'),
      mk('alfa', 'MIT igual'),
      mk('beta', 'otro'),
    ]);
    expect(out.indexOf('alfa 1.0.0')).toBeLessThan(out.indexOf('beta 1.0.0'));
    expect(out.indexOf('beta 1.0.0')).toBeLessThan(out.indexOf('zeta 1.0.0'));
    expect(out).toContain('alfa 1.0.0 — MIT');
    expect(out).toContain('https://r/alfa');
    expect(out.split('MIT igual').length - 1).toBe(1);
    expect(out).toContain('mismo texto que alfa 1.0.0');
    expect(out).toContain('otro');
  });
});

describe('crates MPL-2.0 y textos de la tabla', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('toda crate MPL-2.0 lleva «Código fuente» con repositorio, commit y crates.io; las demás no', () => {
    const mk = (name: string, license: string, sha?: string) => ({
      name,
      version: '0.5.0',
      license,
      authors: [],
      repository: `https://github.com/x/${name}`,
      sha,
      textos: [{ fichero: 'LICENSE', texto: `t ${name}` }],
    });
    const out = rl.avisoRust([
      mk('mozilla', 'MPL-2.0', 'abc123'),
      mk('sinsha', 'MPL-2.0'),
      mk('otra', 'MIT'),
    ]);
    expect(out).toContain(
      'Código fuente: https://github.com/x/mozilla@abc123 (también en crates.io: https://crates.io/crates/mozilla/0.5.0)',
    );
    expect(out).toContain(
      'Código fuente: https://github.com/x/sinsha (también en crates.io: https://crates.io/crates/sinsha/0.5.0)',
    );
    expect(out.split('Código fuente:').length - 1).toBe(2);
  });

  it('textoExtra busca por nombre@versión exacta y devuelve null si no hay', async () => {
    dir = mkdtempSync(join(tmpdir(), 'rust-extra-'));
    writeFileSync(join(dir, 'pepe@1.0.0.txt'), 'Fuente: u\n\ntexto');
    const t = await rl.textoExtra(dir, 'pepe', '1.0.0');
    expect(t).toEqual([
      { fichero: 'rust-licenses-extra/pepe@1.0.0.txt', texto: 'Fuente: u\n\ntexto' },
    ]);
    expect(await rl.textoExtra(dir, 'pepe', '1.0.1')).toBeNull();
  });

  it('la tabla commiteada cubre las 5 crates sin fichero propio, con su fuente en la primera línea', () => {
    for (const n of [
      'webview2-com@0.39.1',
      'webview2-com-macros@0.8.1',
      'webview2-com-sys@0.39.1',
      'selectors@0.38.0',
      'alloc-stdlib@0.3.0',
    ]) {
      const t = readFileSync(
        resolve(__dirname, `../../../../scripts/package/rust-licenses-extra/${n}.txt`),
        'utf8',
      );
      expect(t.split('\n')[0]).toMatch(/^Fuente: https:\/\//);
    }
  });
});
