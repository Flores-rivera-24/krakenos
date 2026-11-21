import { execFileSync, spawnSync } from 'node:child_process';
import { builtinModules, createRequire } from 'node:module';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * El verificador que ejecuta ROOT (`dist/verify-update.js`, `tsup.root.config.ts`) tiene que ser UN
 * fichero autocontenido, como `local-ca.js`: si importara un paquete, root cargaría código de un
 * `node_modules` que quizá no existe o, peor, que modifica el servicio. Se construye de verdad, se
 * saca del repo y se ejecuta sin `node_modules`.
 */
const AGENT = fileURLToPath(new URL('../..', import.meta.url));

let out: string;
let aislado: string;

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'kraken-verify-bundle-'));
  const tsup = createRequire(join(AGENT, 'package.json')).resolve('tsup/dist/cli-default.js');
  execFileSync(
    process.execPath,
    [tsup, '--config', 'tsup.root.config.ts', '--out-dir', join(out, 'build')],
    { cwd: AGENT, stdio: 'pipe' },
  );
  aislado = join(out, 'aislado');
  mkdirSync(aislado);
  copyFileSync(join(out, 'build', 'verify-update.js'), join(aislado, 'verify-update.js'));
}, 60_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('dist/verify-update.js (el que ejecuta root)', () => {
  it('no importa ningún paquete ni el código de red: solo módulos integrados de Node', () => {
    const codigo = readFileSync(join(aislado, 'verify-update.js'), 'utf8');
    const todos = [
      ...[...codigo.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...codigo.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map((m) => m[1]),
      ...[...codigo.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
    ] as string[];
    expect(todos.length, 'guard: el escaneo de imports encontró algo').toBeGreaterThan(2);
    const ajenos = todos.filter((s) => !(s.startsWith('node:') || builtinModules.includes(s)));
    expect(ajenos, `imports que no son de Node: ${ajenos.join(', ')}`).toEqual([]);
    expect(codigo).not.toMatch(/undici|safeFetch/);
  });

  it('arranca solo y rechaza una firma que no es de la clave embebida (exit 1, sin tocar nada)', () => {
    writeFileSync(join(aislado, 'manifest.json'), '{"schema":1}');
    writeFileSync(join(aislado, 'manifest.json.sig'), Buffer.alloc(64).toString('base64'));
    writeFileSync(join(aislado, 'k.deb'), 'x');
    const r = spawnSync(
      process.execPath,
      [
        join(aislado, 'verify-update.js'),
        ...['--manifest', join(aislado, 'manifest.json')],
        ...['--sig', join(aislado, 'manifest.json.sig')],
        ...['--package', join(aislado, 'k.deb')],
        ...['--platform', 'deb-amd64', '--version', '0.3.0', '--installed', '0.2.0'],
      ],
      { cwd: aislado, encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/clave del proyecto/);
  });
});
