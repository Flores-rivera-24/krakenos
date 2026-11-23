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
import { applyLinks, collectLinks, removeLinks } from '../../../../scripts/package/links.mjs';

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
    expect(r).toEqual({ created: 3, existing: 0, redone: 0 });
    expect(readFileSync(join(raiz, 'dep', 'index.js'), 'utf8')).toBe('ok');
    expect(readFileSync(join(raiz, '@s', 'otro', 'index.js'), 'utf8')).toBe('otro');
    expect(await applyLinks(raiz, links)).toEqual({ created: 0, existing: 3, redone: 0 });
  });

  it('rechaza una entrada que sale de la carpeta', async () => {
    await expect(applyLinks(raiz, [{ link: '../fuera', target: 'dep' }])).rejects.toThrow(/fuera/);
    await expect(applyLinks(raiz, [{ link: 'x', target: '../../..' }])).rejects.toThrow(/fuera/);
    await expect(applyLinks(raiz, [{ link: 'C:/x', target: 'dep' }])).rejects.toThrow(/fuera/);
  });
});

describe('applyLinks en una actualización', () => {
  it('un enlace que ya existe con OTRO destino se rehace, no se da por bueno', async () => {
    const links = await collectLinks(raiz);
    rmSync(join(raiz, 'dep'), { recursive: false, force: true });
    symlinkSync(
      join(raiz, '.pnpm', 'otro@2.0.0', 'node_modules', '@s', 'otro'),
      join(raiz, 'dep'),
      'junction',
    );
    expect(readFileSync(join(raiz, 'dep', 'index.js'), 'utf8')).toBe('otro');
    expect(await applyLinks(raiz, links)).toEqual({ created: 0, existing: 2, redone: 1 });
    expect(readFileSync(join(raiz, 'dep', 'index.js'), 'utf8')).toBe('ok');
  });

  it('un enlace colgante (su destino ya no existe) también se rehace', async () => {
    const links = await collectLinks(raiz);
    rmSync(join(raiz, 'dep'), { recursive: false, force: true });
    symlinkSync(join(raiz, 'no-existe'), join(raiz, 'dep'), 'junction');
    expect((await applyLinks(raiz, links)).redone).toBe(1);
    expect(readFileSync(join(raiz, 'dep', 'index.js'), 'utf8')).toBe('ok');
  });

  it('lo que no es un enlace (una carpeta real con ese nombre) no se toca', async () => {
    const links = await collectLinks(raiz);
    rmSync(join(raiz, 'dep'), { recursive: false, force: true });
    mkdirSync(join(raiz, 'dep'));
    writeFileSync(join(raiz, 'dep', 'mio.txt'), 'x');
    expect((await applyLinks(raiz, links)).redone).toBe(0);
    expect(existsSync(join(raiz, 'dep', 'mio.txt'))).toBe(true);
  });
});

describe('removeLinks', () => {
  it('quita los enlaces del manifiesto SIN tocar lo que hay detrás ni seguirlos', async () => {
    const links = await collectLinks(raiz);
    await removeLinks(raiz, links);
    for (const l of links) expect(existsSync(join(raiz, l.link))).toBe(false);
    expect(
      readFileSync(join(raiz, '.pnpm', 'dep@1.0.0', 'node_modules', 'dep', 'index.js'), 'utf8'),
    ).toBe('ok');
    expect(
      readFileSync(
        join(raiz, '.pnpm', 'otro@2.0.0', 'node_modules', '@s', 'otro', 'index.js'),
        'utf8',
      ),
    ).toBe('otro');
  });

  it('se puede repetir: lo que ya no está no es un error', async () => {
    const links = await collectLinks(raiz);
    await removeLinks(raiz, links);
    await expect(removeLinks(raiz, links)).resolves.toEqual({ removed: 0 });
  });

  it('rechaza entradas que salen de la carpeta y no borra nada de lo anterior', async () => {
    await expect(removeLinks(raiz, [{ link: '../fuera', target: 'dep' }])).rejects.toThrow(/fuera/);
  });

  it('no borra una carpeta real aunque el manifiesto la nombre', async () => {
    rmSync(join(raiz, 'dep'), { recursive: false, force: true });
    mkdirSync(join(raiz, 'dep'));
    writeFileSync(join(raiz, 'dep', 'mio.txt'), 'x');
    await removeLinks(raiz, [{ link: 'dep', target: '.pnpm/dep@1.0.0/node_modules/dep' }]);
    expect(existsSync(join(raiz, 'dep', 'mio.txt'))).toBe(true);
  });
});
