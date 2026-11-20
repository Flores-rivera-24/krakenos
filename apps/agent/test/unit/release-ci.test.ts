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
    // `ventana` es experimental (`continue-on-error: true`): no bloquea la release.
    expect(lista).not.toContain('ventana');
    expect(bloqueantes).not.toContain('ventana');
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
