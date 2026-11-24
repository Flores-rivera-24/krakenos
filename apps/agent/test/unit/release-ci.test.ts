import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** El job `release` de ci.yml: adjunta los paquetes de Linux a la release de un tag `v*`. */

const CI = readFileSync(
  fileURLToPath(new URL('../../../../.github/workflows/ci.yml', import.meta.url)),
  'utf8',
);

/** Los jobs, partidos por su clave de 2 espacios bajo `jobs:` (el YAML se lee como texto, como los demás tests). */
function jobs(): Record<string, string> {
  const resto = CI.slice(CI.indexOf('\njobs:\n') + 7);
  const out: Record<string, string> = {};
  const trozos = resto.split(/^ {2}([a-z][a-z0-9-]*):\s*$/m);
  for (let i = 1; i < trozos.length; i += 2) out[trozos[i] as string] = trozos[i + 1] as string;
  return out;
}

const J = jobs();
const release = J['release'] ?? '';
const cabecera = (j: string) => j.slice(0, j.indexOf('\n    steps:'));

describe('ci.yml (job release)', () => {
  it('lee los jobs (guard de tamaño: si el parseo se rompe, nada de lo de abajo vigila)', () => {
    expect(Object.keys(J).length).toBeGreaterThanOrEqual(8);
    expect(release).not.toBe('');
  });

  it('el workflow se dispara también en tags v* sin perder los disparadores de siempre', () => {
    const on = CI.slice(CI.indexOf('\non:'), CI.indexOf('\nconcurrency:'));
    expect(on).toMatch(/tags:\s*\['v\*'\]/);
    expect(on).toContain('branches: [main]');
    expect(on).toContain('pull_request:');
    expect(on).toContain('schedule:');
  });

  it('corre SOLO en tags v*', () => {
    expect(cabecera(release)).toMatch(/if: \$\{\{ startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}/);
  });

  it('es el único job con `contents: write` y el workflow sigue en solo lectura', () => {
    expect(cabecera(release)).toMatch(/permissions:\s*\n\s+contents: write/);
    expect(CI.match(/^\s+contents: write$/gm)).toHaveLength(1);
    expect(CI).toMatch(/^permissions:\n {2}contents: read$/m);
  });

  it('espera a TODO job bloqueante (la lista sale del propio YAML)', () => {
    const bloqueantes = Object.entries(J)
      .filter(([n, j]) => n !== 'release' && !/^ {4}continue-on-error: true\s*$/m.test(cabecera(j)))
      .map(([n]) => n);
    expect(bloqueantes).toEqual(
      expect.arrayContaining(['build-test', 'windows', 'package', 'package-arch', 'e2e']),
    );
    const needs = /^ {4}needs: \[([^\]]*)\]/m.exec(cabecera(release))?.[1] ?? '';
    const lista = needs.split(',').map((s) => s.trim());
    for (const n of bloqueantes) expect(lista, `release no espera a ${n}`).toContain(n);
    // `ventana` e `instalador-windows` ya no son experimentales: bloquean y la release los espera.
    for (const n of ['ventana', 'instalador-windows']) {
      expect(bloqueantes, `${n} no debe llevar continue-on-error`).toContain(n);
      expect(lista, `release no espera a ${n}`).toContain(n);
    }
  });

  it('falla si el tag no es `v` + la versión de package.json', () => {
    const primero = release.slice(
      release.indexOf('steps:'),
      release.indexOf('actions/download-artifact'),
    );
    expect(primero).toContain('GITHUB_REF_NAME');
    expect(primero).toMatch(/package\.json/);
    expect(primero).toMatch(/exit 1/);
  });

  it('ensambla con assemble.mjs y adjunta .deb, Arch, portables de Linux y SHA256SUMS', () => {
    expect(release).toMatch(
      /node scripts\/release\/assemble\.mjs "\$RUNNER_TEMP\/dl" release "\$VERSION"/,
    );
    expect(release).toMatch(/pattern: krakenos-\{deb-\*,arch,portable-\*\}/);
    const subida = /gh release upload (?:[^\n]*\\\n)*[^\n]*/.exec(release)?.[0] ?? '';
    for (const f of ['*.deb', '*.pkg.tar.zst', '*.tar.gz', 'SHA256SUMS', 'manifest.json.sig'])
      expect(subida, f).toContain(f);
    // El zip de Windows no sale en esta parte (parte B, con el manifiesto de enlaces del instalador).
    expect(subida).not.toContain('.zip');
  });

  it('las notas salen de los commits: historial completo, notes.mjs y --notes-file solo al crear', () => {
    expect(release).toMatch(/fetch-depth: 0/);
    expect(release).toMatch(
      /node scripts\/release\/notes\.mjs "\$GITHUB_REF_NAME" "\$VERSION" release > "\$RUNNER_TEMP\/notes\.md"/,
    );
    const crear = /gh release create (?:[^\n]*\\\n)*[^\n]*/.exec(release)?.[0] ?? '';
    expect(crear).toContain('--notes-file "$RUNNER_TEMP/notes.md"');
    expect(release).not.toContain('--notes "');
    // Solo dentro del `if ! gh release view`: si ya existe no se le pisan las notas.
    expect(release.slice(release.indexOf('if ! gh release view'))).toContain(crear);
    expect(release.split('--notes-file').length).toBe(2);
  });

  it('crea la release como borrador y verifica el tag; no adjunta el .exe', () => {
    expect(release).toMatch(/gh release create [^\n]*--draft/);
    expect(release).toContain('--verify-tag');
    expect(release).toContain('GH_TOKEN: ${{ github.token }}');
    expect(release).not.toMatch(/\.exe/);
  });

  it('los paquetes se suben como artefacto en los jobs que los construyen', () => {
    expect(J['package']).toMatch(/name: krakenos-deb-\$\{\{ matrix\.target \}\}/);
    expect(J['package-arch']).toMatch(/name: krakenos-arch/);
  });
});

describe('ci.yml (job package) · portables', () => {
  const pkg = J['package'] ?? '';

  it('comprime el portable tras empaquetar y ANTES del smoke (el smoke arranca el paquete y lo ensucia)', () => {
    const empaquetar = pkg.indexOf('name: Empaquetar');
    const archivo = pkg.indexOf('node scripts/package-archive.mjs');
    const smoke = pkg.indexOf('name: Smoke del paquete');
    expect(empaquetar).toBeGreaterThan(-1);
    expect(archivo).toBeGreaterThan(empaquetar);
    expect(smoke).toBeGreaterThan(archivo);
  });

  it('exige el bit de ejecución y VERSION en el tar', () => {
    expect(pkg).toContain('tar -tvzf');
    expect(pkg).toContain('-rwxr-xr-x');
    expect(pkg).toMatch(/node\/bin\/node/);
    expect(pkg).toMatch(/bin\/krakenos/);
  });

  it('solo Linux: el zip de Windows queda fuera hasta que los enlaces de pnpm se resuelvan', () => {
    const paso = pkg.slice(
      pkg.indexOf('name: Archivo portable'),
      pkg.indexOf('name: Smoke del paquete'),
    );
    expect(paso).toContain("if: ${{ startsWith(matrix.target, 'linux-') }}");
    expect(paso).not.toContain('tar.exe');
  });

  it('sube el portable como krakenos-portable-<target>', () => {
    expect(pkg).toMatch(/name: krakenos-portable-\$\{\{ matrix\.target \}\}/);
    expect(pkg).toContain('path: out/portable/*');
  });
});

describe('ci.yml (job release-ensayo)', () => {
  const ensayo = J['release-ensayo'] ?? '';
  const cab = cabecera(ensayo);
  const invocaciones = (j: string) =>
    j.match(/^\s*(?:run: )?node scripts\/release\/\S+.*$/gm) ?? [];
  const sinSangria = (l: string) => l.trim().replace(/^run: /, '');

  it('existe y corre cuando NO es tag, sin bloquear nada', () => {
    expect(ensayo).not.toBe('');
    expect(cab).toMatch(
      /if: \$\{\{ !cancelled\(\) && !startsWith\(github\.ref, 'refs\/tags\/v'\) \}\}/,
    );
    expect(cab).toMatch(/^ {4}continue-on-error: true\s*$/m);
    const needs = /^ {4}needs: \[([^\]]*)\]/m.exec(cab)?.[1] ?? '';
    expect(needs).toContain('package');
    expect(needs).toContain('package-arch');
  });

  it('no puede publicar: solo lectura, sin gh release ni subidas', () => {
    expect(cab).not.toMatch(/contents: write/);
    expect(ensayo).not.toContain('gh release');
    expect(ensayo).not.toContain('upload-artifact');
  });

  it('el único secreto es UPDATE_SIGNING_KEY, solo en push; la clave efímera, solo fuera de push', () => {
    expect(ensayo.match(/secrets\.[A-Za-z_]+/g)).toEqual(['secrets.UPDATE_SIGNING_KEY']);
    const pasos = ensayo.split(/^ {6}- name: /m).slice(1);
    const conSecreto = pasos.filter((p) => p.includes('secrets.'));
    expect(conSecreto).toHaveLength(1);
    expect(conSecreto[0]).toContain("if: ${{ github.event_name == 'push' }}");
    // Esa variable salta la comprobación contra la clave embebida: ni en `release` ni con el secreto real.
    // (sin comentarios: el de antes de `release-ensayo` cae al final del trozo de `release`)
    expect(release.replace(/^\s*#.*$/gm, '')).not.toContain('UPDATE_VERIFY_PUBLIC_KEY');
    expect(conSecreto[0]).not.toContain('UPDATE_VERIFY_PUBLIC_KEY');
    const efimera = pasos.filter((p) => p.includes('generateKeyPairSync'));
    expect(efimera).toHaveLength(1);
    expect(efimera[0]).toContain("if: ${{ github.event_name != 'push' }}");
    expect(efimera[0]).toContain('::add-mask::');
  });

  it('usa los mismos scripts que release, con las mismas invocaciones', () => {
    const nombres = (j: string) =>
      new Set(invocaciones(j).map((l) => /release\/([\w-]+)\.mjs/.exec(l)?.[1]));
    expect(nombres(ensayo)).toEqual(new Set(['assemble', 'sign-manifest', 'notes']));
    const delEnsayo = invocaciones(ensayo).map(sinSangria);
    const deRelease = invocaciones(release).map(sinSangria);
    for (const l of deRelease.filter((x) => !x.includes('notes.mjs')))
      expect(delEnsayo, l).toContain(l);
    expect(ensayo).toContain('node scripts/release/notes.mjs HEAD "$VERSION" release');
    expect(ensayo).toMatch(/pattern: krakenos-\{deb-\*,arch,portable-\*\}/);
    expect(ensayo).toMatch(/fetch-depth: 0/);
  });

  it('comprueba los archivos y re-verifica la firma', () => {
    for (const f of ['manifest.json', 'manifest.json.sig', 'SHA256SUMS', 'notes.md'])
      expect(ensayo).toContain(f);
    // La verificación vive en el paso «Comprobar el resultado», contra la pública correcta.
    const paso = ensayo.slice(ensayo.indexOf('- name: Comprobar el resultado'));
    expect(paso).toContain('crypto.verify(null, readFileSync("release/manifest.json")');
    expect(paso).toContain('crypto.createPublicKey(pem)');
    expect(paso).toContain('process.env.UPDATE_VERIFY_PUBLIC_KEY ??'); // efímera en PR
    expect(paso).toContain('update-signing-key.ts'); // embebida en push
    expect(paso).toContain('if (!ok) fail(');
  });

  it('ningún `env:` a nivel de job define UPDATE_VERIFY_PUBLIC_KEY (saltaría la clave embebida)', () => {
    for (const j of [cab, cabecera(release)])
      expect(j.replace(/^\s*#.*$/gm, '')).not.toContain('UPDATE_VERIFY_PUBLIC_KEY');
  });

  it('la descarga de artefactos junta todo en una carpeta (merge-multiple) en release y en el ensayo', () => {
    for (const j of [release, ensayo]) {
      const paso = j.slice(j.indexOf('actions/download-artifact'));
      expect(paso.slice(0, paso.indexOf('\n\n'))).toContain('merge-multiple: true');
    }
  });
});
