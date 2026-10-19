import { execFileSync } from 'node:child_process';
import { builtinModules, createRequire } from 'node:module';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { X509Certificate } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * La CLI de la CA local que ejecuta ROOT (`dist/local-ca.js`, `tsup.root.config.ts`) tiene
 * que ser UN fichero autocontenido.
 *
 * El timer `krakenos-cert-local` corre como root y la copia de ese fichero vive en
 * `/usr/local/lib/krakenos/`, donde no hay `node_modules`: si el bundle importara un
 * paquete (`@peculiar/x509`…), o fallaría al arrancar el mes en que toca renovar, o —peor,
 * si alguien «lo arregla» con un `NODE_PATH`— root cargaría código del árbol del servicio,
 * que el servicio puede modificar. Se construye de verdad, se saca del repo a un
 * directorio SIN `node_modules` y se ejecuta.
 */
const AGENT = fileURLToPath(new URL('../..', import.meta.url));

let out: string;
let aislado: string;

beforeAll(() => {
  out = mkdtempSync(join(tmpdir(), 'kraken-bundle-'));
  const tsup = createRequire(join(AGENT, 'package.json')).resolve('tsup/dist/cli-default.js');
  execFileSync(
    process.execPath,
    [tsup, '--config', 'tsup.root.config.ts', '--out-dir', join(out, 'build')],
    { cwd: AGENT, stdio: 'pipe' },
  );
  // Fuera del repo: ningún `node_modules` en ningún directorio por encima.
  aislado = join(out, 'aislado');
  mkdirSync(aislado);
  copyFileSync(join(out, 'build', 'local-ca.js'), join(aislado, 'local-ca.js'));
}, 60_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));

describe('dist/local-ca.js (el que ejecuta root)', () => {
  it('no importa ningún paquete: solo módulos integrados de Node', () => {
    const codigo = readFileSync(join(aislado, 'local-ca.js'), 'utf8');
    const imports = [...codigo.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g)].map(
      (m) => m[1] ?? '',
    );
    const importsSueltos = [...codigo.matchAll(/(?:^|\n)\s*import\s*["']([^"']+)["']/g)].map(
      (m) => m[1] ?? '',
    );
    const dinamicos = [...codigo.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map(
      (m) => m[1] ?? '',
    );
    const todos = [...imports, ...importsSueltos, ...dinamicos];
    expect(todos.length, 'guard: el escaneo de imports encontró algo').toBeGreaterThan(3);
    const esIntegrado = (spec: string) => spec.startsWith('node:') || builtinModules.includes(spec);
    const ajenos = todos.filter((spec) => !esIntegrado(spec));
    expect(ajenos, `imports que no son de Node: ${ajenos.join(', ')}`).toEqual([]);
    // Ni `require()` de un paquete que no sea integrado.
    const requires = [...codigo.matchAll(/\brequire\(\s*["']([^"'.][^"']*)["']\s*\)/g)].map(
      (m) => m[1] ?? '',
    );
    const requiresAjenos = requires.filter((spec) => !esIntegrado(spec));
    expect(requiresAjenos).toEqual([]);
  });

  it('arranca SOLO, sin node_modules, y emite una CA y un servidor válidos', () => {
    const certs = join(out, 'certs');
    const keys = join(out, 'keys');
    const salida = execFileSync(process.execPath, [join(aislado, 'local-ca.js')], {
      cwd: aislado,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH ?? '',
        KRAKENOS_CERTS_DIR: certs,
        KRAKENOS_KEYS_DIR: keys,
        KRAKENOS_HOSTNAME: 'casa',
        KRAKENOS_LAN_IP: '192.168.1.50',
      },
    });
    expect(salida).toContain('Creando la CA local de KrakenOS');
    const ca = new X509Certificate(readFileSync(join(certs, 'krakenos-ca.pem')));
    const srv = new X509Certificate(readFileSync(join(certs, 'agent-cert.pem')));
    expect(srv.checkIssued(ca)).toBe(true);
    expect(srv.verify(ca.publicKey)).toBe(true);
    expect((statSync(join(keys, 'krakenos-ca-key.pem')).mode & 0o777).toString(8)).toBe('600');
  });
});
