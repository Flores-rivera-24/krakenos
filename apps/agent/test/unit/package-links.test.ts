import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { applyLinks, collectLinks } from '../../../../scripts/package/links.mjs';

/** Manifiesto de enlaces de pnpm: el bundler NSIS no copia junctions, el instalador las rehace. */

let raiz: string;
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'krakenos-links-'));
  const dep = join(raiz, '.pnpm', 'dep@1.0.0', 'node_modules', 'dep');
  mkdirSync(dep, { recursive: true });
  writeFileSync(join(dep, 'index.js'), 'ok');
  const hermano = join(raiz, '.pnpm', 'otro@2.0.0', 'node_modules', '@s', 'otro');
  mkdirSync(hermano, { recursive: true });
  writeFileSync(join(hermano, 'index.js'), 'otro');
  // primer nivel y enlace entre paquetes dentro de .pnpm (los dos tipos que crea pnpm)
  symlinkSync(dep, join(raiz, 'dep'), 'junction');
  mkdirSync(join(raiz, '@s'));
  symlinkSync(hermano, join(raiz, '@s', 'otro'), 'junction');
  symlinkSync(hermano, join(raiz, '.pnpm', 'dep@1.0.0', 'node_modules', 'otro-link'), 'junction');
});
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

describe('collectLinks', () => {
  it('lista cada enlace con ruta relativa con / y destino relativo, ordenados', async () => {
    const links = await collectLinks(raiz);
    expect(links).toEqual([
      {
        link: '.pnpm/dep@1.0.0/node_modules/otro-link',
        target: '../../otro@2.0.0/node_modules/@s/otro',
      },
      { link: '@s/otro', target: '../.pnpm/otro@2.0.0/node_modules/@s/otro' },
      { link: 'dep', target: '.pnpm/dep@1.0.0/node_modules/dep' },
    ]);
  });

  it('no baja por los enlaces (no cuenta lo que hay detrás)', async () => {
    expect((await collectLinks(raiz)).length).toBe(3);
  });
});

describe('applyLinks', () => {
  it('recrea los enlaces que faltan y se puede repetir', async () => {
    const links = await collectLinks(raiz);
    for (const l of links) rmSync(join(raiz, l.link), { recursive: false, force: true });
    expect(existsSync(join(raiz, 'dep'))).toBe(false);

    const r = await applyLinks(raiz, links);
    expect(r).toEqual({ created: 3, existing: 0 });
    expect(readFileSync(join(raiz, 'dep', 'index.js'), 'utf8')).toBe('ok');
    expect(readFileSync(join(raiz, '@s', 'otro', 'index.js'), 'utf8')).toBe('otro');
    expect(await applyLinks(raiz, links)).toEqual({ created: 0, existing: 3 });
  });

  it('rechaza una entrada que sale de la carpeta', async () => {
    await expect(applyLinks(raiz, [{ link: '../fuera', target: 'dep' }])).rejects.toThrow(/fuera/);
    await expect(applyLinks(raiz, [{ link: 'x', target: '../../..' }])).rejects.toThrow(/fuera/);
    await expect(applyLinks(raiz, [{ link: 'C:/x', target: 'dep' }])).rejects.toThrow(/fuera/);
  });
});
