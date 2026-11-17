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

  it('adjunta los dos .deb, el paquete de Arch y SHA256SUMS', () => {
    expect(release).toMatch(/krakenos_\$\{?VERSION\}?_amd64\.deb/);
    expect(release).toMatch(/krakenos_\$\{?VERSION\}?_arm64\.deb/);
    expect(release).toContain('.pkg.tar.zst');
    expect(release).toMatch(/sha256sum [^\n]*> SHA256SUMS/);
    expect(release).toMatch(/gh release upload [^\n]*SHA256SUMS/);
  });

  it('crea la release como borrador y verifica el tag; no adjunta portables ni .exe', () => {
    expect(release).toMatch(/gh release create [^\n]*--draft/);
    expect(release).toContain('--verify-tag');
    expect(release).toContain('GH_TOKEN: ${{ github.token }}');
    expect(release).not.toMatch(/\.zip|\.tar\.gz|\.exe/);
  });

  it('los paquetes se suben como artefacto en los jobs que los construyen', () => {
    expect(J['package']).toMatch(/name: krakenos-deb-\$\{\{ matrix\.target \}\}/);
    expect(J['package-arch']).toMatch(/name: krakenos-arch/);
  });
});
