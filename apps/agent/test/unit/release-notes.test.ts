/**
 * `scripts/release/notes.mjs`: las notas de la versión salen de los commits convencionales entre dos
 * tags. `parseCommit` y `buildNotes` son puras; el CLI se prueba contra un repo git temporal.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../scripts/release/notes.mjs', import.meta.url));
const { parseCommit, buildNotes } = (await import(SCRIPT)) as {
  parseCommit: (
    s: string,
    body?: string,
  ) => { type: string; breaking: boolean; text: string } | null;
  buildNotes: (i: { version: string; commits: string[]; assets: string[] }) => string;
};

const V = '0.3.0';
const ASSETS = [
  `krakenos_${V}_amd64.deb`,
  `krakenos_${V}_arm64.deb`,
  `krakenos-${V}-1-x86_64.pkg.tar.zst`,
  `krakenos-${V}-linux-x64.tar.gz`,
  `krakenos-${V}-linux-arm64.tar.gz`,
  `KrakenOS-Setup-${V}-x64.exe`,
  'SHA256SUMS',
  'manifest.json',
  'manifest.json.sig',
];

describe('parseCommit', () => {
  it('quita el id de historia y el paréntesis vacío', () => {
    expect(parseCommit('feat(web): vista nueva (US-290)')).toEqual({
      type: 'feat',
      breaking: false,
      text: 'vista nueva',
    });
  });
  it('quita la referencia (#123)', () => {
    expect(parseCommit('fix: arregla X (#123)')?.text).toBe('arregla X');
  });
  it('quita ids sueltos a mitad de frase', () => {
    expect(parseCommit('fix: lo de US-77 y (#5, US-8) funciona')?.text).toBe('lo de y funciona');
  });
  it.each([
    ['feat: US-290: algo', 'algo'],
    ['feat: x (US-1/US-2)', 'x'],
    ['fix: arregla us-12', 'arregla'],
    ['feat: x (US-12a)', 'x'],
    ['feat: y US\u201112 z', 'y z'],
    ['fix: arregla algo, Closes #4', 'arregla algo'],
    ['fix: Fixes #4 y más', 'y más'],
    ['fix: algo (#12, US-3)', 'algo'],
    ['fix: foo US-3: bar', 'foo: bar'],
    ['fix: arregla algo, #12, y más', 'arregla algo, y más'],
    ['fix: arregla algo #12', 'arregla algo'],
  ])('limpia %j → %j sin puntuación huérfana', (entrada, salida) => {
    expect(parseCommit(entrada)?.text).toBe(salida);
  });
  it('un #12 que no es referencia (a mitad de frase) se conserva', () => {
    expect(parseCommit('fix: el paso #12 del asistente falla')?.text).toBe(
      'el paso #12 del asistente falla',
    );
  });
  it('BREAKING CHANGE: en el cuerpo marca breaking; sin él, no', () => {
    expect(parseCommit('feat: x', 'detalle\n\nBREAKING CHANGE: cambia el contrato')?.breaking).toBe(
      true,
    );
    expect(parseCommit('feat: x', 'detalle sin nada')?.breaking).toBe(false);
  });
  it('feat! y fix(x)! son breaking', () => {
    expect(parseCommit('feat!: cambia el contrato')).toMatchObject({
      type: 'feat',
      breaking: true,
    });
    expect(parseCommit('fix(api)!: otro')).toMatchObject({ type: 'fix', breaking: true });
  });
  it('un subject no convencional es type otros', () => {
    expect(parseCommit('Actualiza cosas')).toEqual({
      type: 'otros',
      breaking: false,
      text: 'Actualiza cosas',
    });
  });
  it('un subject que es solo un id da null', () => {
    expect(parseCommit('US-290')).toBeNull();
    expect(parseCommit('feat: (US-290)')).toBeNull();
    expect(parseCommit('')).toBeNull();
  });
});

describe('buildNotes', () => {
  const commits = [
    'feat(web): vista nueva (US-290)',
    'fix: arregla X (#123)',
    'perf: acelera el barrido',
    'feat!: cambia el formato del manifiesto',
    'docs: guía',
    'test: cubre algo',
    'ci: ajusta',
    'Actualiza cosas',
  ];
  const md = buildNotes({ version: V, commits, assets: ASSETS });

  it('tiene Novedades, Correcciones y Requiere atención, sin ids internos', () => {
    expect(md).toContain('## Qué cambia');
    expect(md).toContain('**Novedades**');
    expect(md).toContain('**Correcciones**');
    expect(md).toContain('**Requiere atención**');
    expect(md).toContain('- vista nueva');
    expect(md).toContain('- acelera el barrido');
    expect(md).not.toMatch(/\bUS-\d+/);
    expect(md).not.toMatch(/\(#\d+\)/);
  });
  it('cuenta los cambios internos sin listarlos', () => {
    expect(md).toContain('4 cambios internos no listados');
    expect(md).not.toContain('cubre algo');
  });
  it('sin feat ni fix dice que no hay cambios visibles, sin sección vacía', () => {
    const vacio = buildNotes({ version: V, commits: ['docs: x', 'ci: y'], assets: ASSETS });
    expect(vacio).toContain('Esta versión no trae cambios visibles');
    expect(vacio).not.toContain('**Novedades**');
    expect(vacio).not.toContain('**Correcciones**');
    expect(vacio).toContain('2 cambios internos no listados');
  });
  it('un solo cambio interno va en singular', () => {
    expect(buildNotes({ version: V, commits: ['docs: x'], assets: ASSETS })).toContain(
      '1 cambio interno no listado',
    );
  });
  it('la tabla de descargas lista solo los assets recibidos', () => {
    const md2 = buildNotes({
      version: V,
      commits,
      assets: [`krakenos_${V}_amd64.deb`, 'SHA256SUMS'],
    });
    expect(md2).toContain(`krakenos_${V}_amd64.deb`);
    expect(md2).not.toContain('arm64');
    expect(md2).not.toContain('Arch Linux');
    expect(md2).not.toMatch(/windows/i);
    for (const a of ASSETS) expect(md).toContain(a);
  });
  it('el instalador de Windows tiene su fila, sin prometer actualización automática', () => {
    const fila = md.split('\n').find((l) => l.includes(`KrakenOS-Setup-${V}-x64.exe`)) ?? '';
    expect(fila).toMatch(/Windows.*servicio/);
    expect(md).not.toMatch(/actualizaci[oó]n autom[aá]tica/i);
  });
  it('lleva la verificación (la suma no es una firma) y las guías de actualización', () => {
    expect(md).toContain('## Verificar la descarga');
    expect(md).toContain('sha256sum -c --ignore-missing SHA256SUMS');
    expect(md).toMatch(/no es una firma/);
    expect(md).toContain('Get-FileHash .\\<archivo> -Algorithm SHA256');
    expect(md).toContain('## Actualizar');
    expect(md).toContain('docs/updates.md');
  });
});

describe('CLI notes.mjs', () => {
  let repo: string;
  const git = (...a: string[]) =>
    spawnSync(
      'git',
      ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...a],
      {
        cwd: repo,
        encoding: 'utf8',
      },
    );
  const commit = (msg: string) => git('commit', '--allow-empty', '-m', msg);
  const cli = (ref: string) =>
    spawnSync(process.execPath, [SCRIPT, ref, '0.2.0', join(repo, 'release')], {
      cwd: repo,
      encoding: 'utf8',
    });

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'notes-'));
    git('init', '-q', '-b', 'main');
    mkdirSync(join(repo, 'release'));
    writeFileSync(join(repo, 'release', 'SHA256SUMS'), '');
    writeFileSync(join(repo, 'release', 'krakenos_0.2.0_amd64.deb'), '');
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it('toma solo lo posterior al tag previo y salta los merges', () => {
    commit('feat: antiguo');
    git('tag', 'v0.1.0');
    git('checkout', '-q', '-b', 'rama');
    commit('fix: de la rama');
    git('checkout', '-q', 'main');
    commit('feat: nuevo (US-1)');
    git('merge', '--no-ff', '-m', 'Merge pull request #9 from x/rama', 'rama');
    git('tag', 'v0.2.0');
    const r = cli('v0.2.0');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('- nuevo');
    expect(r.stdout).toContain('- de la rama');
    expect(r.stdout).not.toContain('antiguo');
    expect(r.stdout).not.toContain('Merge');
    expect(r.stdout).toContain('krakenos_0.2.0_amd64.deb');
    expect(r.stdout).not.toMatch(/\bUS-\d+/);
  });

  it.each(['feat: ver docs/internal/retomar.md', 'feat: algo con US\u2011x12 y docs/internal/x'])(
    'la red de seguridad: %j que la limpieza no trata hace salir con 1 y nombra el commit',
    (subject) => {
      commit('feat: antiguo');
      git('tag', 'v0.1.0');
      commit(subject);
      git('tag', 'v0.2.0');
      const r = cli('v0.2.0');
      expect(r.status).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toContain('identificador interno');
      expect(r.stderr).toContain(subject);
    },
  );

  it('un tag -rc no cuenta como versión anterior: parte del último estable', () => {
    commit('feat: antiguo');
    git('tag', 'v0.1.0');
    commit('feat: entre estable y rc');
    git('tag', 'v0.2.0-rc.1');
    commit('feat: despues del rc');
    git('tag', 'v0.2.0');
    const r = cli('v0.2.0');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('- entre estable y rc');
    expect(r.stdout).toContain('- despues del rc');
  });

  it('BREAKING CHANGE: en el cuerpo de un commit sale en «Requiere atención» sin publicar el cuerpo', () => {
    commit('feat: antiguo');
    git('tag', 'v0.1.0');
    commit('feat: cambia algo\n\nexplicación interna\n\nBREAKING CHANGE: ya no hay X');
    git('tag', 'v0.2.0');
    const r = cli('v0.2.0');
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('**Requiere atención**');
    expect(r.stdout).toContain('- cambia algo');
    expect(r.stdout).not.toContain('explicación interna');
    expect(r.stdout).not.toContain('ya no hay X');
  });

  it('sin tag previo sale con 1 y lo dice', () => {
    commit('feat: algo');
    git('tag', 'v0.2.0');
    const r = cli('v0.2.0');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no hay una versión anterior de la que partir');
  });
});
