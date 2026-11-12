import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { renderEnvFile, stageCommonTree } from '../../../../scripts/package/linux-common.mjs';
// prettier-ignore
// @ts-expect-error — idem.
import { KIND_VARS } from '../../../../scripts/package/launchers/first-run.mjs';

/** Lo común a los paquetes de Linux: el .env generado y el árbol de archivos que los dos arman. */

const RAIZ_REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const WIN = process.platform === 'win32';

const PLANTILLA = [
  'PORT=3001',
  'HOST=127.0.0.1',
  ...KIND_VARS.map((v: string) => `${v}_KIND=mock`),
  '# KRAKENOS_DATA_DIR=/var/lib/krakenos',
  'KRAKENOS_DATA_DIR=/otro/sitio',
  '',
].join('\n');

let raiz: string;
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'kraken-comun-'));
});
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

function paqueteFalso(): string {
  const pkg = join(raiz, 'pkg');
  for (const d of ['bin', 'node/bin', 'app/agent/dist'])
    mkdirSync(join(pkg, d), { recursive: true });
  writeFileSync(join(pkg, 'bin', 'krakenos'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(pkg, 'node', 'bin', 'node'), 'x', { mode: 0o755 });
  writeFileSync(join(pkg, 'app', 'agent', '.env.example'), PLANTILLA);
  writeFileSync(join(pkg, 'app', 'agent', 'dist', 'local-ca.js'), '//');
  // Un paquete mal armado (umask laxa): lo escribible por otros debe quitarse al armar el árbol.
  chmodSync(join(pkg, 'app', 'agent', 'dist', 'local-ca.js'), 0o666);
  chmodSync(join(pkg, 'app', 'agent', 'dist'), 0o777);
  return pkg;
}

function recorrer(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    acc.push(p);
    if (e.isDirectory()) recorrer(p, acc);
  }
  return acc;
}

describe('renderEnvFile', () => {
  it('pone los ocho kinds en none', () => {
    const out: string = renderEnvFile(PLANTILLA);
    expect(KIND_VARS).toHaveLength(8);
    for (const v of KIND_VARS) expect(out).toMatch(new RegExp(`^${v}_KIND=none$`, 'm'));
    expect(out).not.toContain('mock');
  });

  it('fija el modo package y el directorio de datos, sin duplicar claves', () => {
    const out: string = renderEnvFile(PLANTILLA);
    expect(out).toMatch(/^KRAKENOS_DATA_DIR=\/var\/lib\/krakenos$/m);
    expect(out).toMatch(/^KRAKENOS_DEPLOY_MODE=package$/m);
    expect(out).toMatch(/^HOST=0\.0\.0\.0$/m);
    for (const k of ['HOST', 'KRAKENOS_DATA_DIR', 'KRAKENOS_DEPLOY_MODE'])
      expect(out.match(new RegExp(`^${k}=`, 'gm'))).toHaveLength(1);
    expect(out).toContain('PORT=3001');
  });
});

describe('stageCommonTree', () => {
  it.skipIf(WIN)('no deja nada escribible por otros bajo usr/lib/krakenos', async () => {
    const root = join(raiz, 'root');
    await stageCommonTree(paqueteFalso(), root);
    const todo = recorrer(join(root, 'usr', 'lib', 'krakenos'));
    expect(todo.length).toBeGreaterThan(5);
    for (const p of todo) {
      const st = lstatSync(p);
      if (st.isSymbolicLink()) continue;
      expect(st.mode & 0o022, p).toBe(0);
    }
  });

  it.skipIf(WIN)('coloca cada pieza donde la espera el sistema', async () => {
    const root = join(raiz, 'root');
    await stageCommonTree(paqueteFalso(), root);
    const modo = (p: string) => lstatSync(join(root, p)).mode & 0o777;
    const lib = 'usr/lib/krakenos/libexec';
    expect(modo(`${lib}/krakenos-setup`)).toBe(0o755);
    expect(modo(`${lib}/krakenos-helper`)).toBe(0o755);
    expect(modo(`${lib}/lib/krakenos-system.sh`) & 0o111).toBe(0);
    expect(modo('etc/krakenos/krakenos.env')).toBe(0o640);
    expect(lstatSync(join(root, 'usr/bin/krakenos-setup')).isSymbolicLink()).toBe(true);
    for (const f of [
      'usr/lib/systemd/system/krakenos.service',
      'usr/lib/sysusers.d/krakenos.conf',
      'usr/lib/tmpfiles.d/krakenos.conf',
      'usr/lib/krakenos/bin/krakenos',
    ])
      expect(lstatSync(join(root, f)).isFile(), f).toBe(true);
    const env = readFileSync(join(root, 'etc/krakenos/krakenos.env'), 'utf8');
    expect(env).toMatch(/^KRAKENOS_DEPLOY_MODE=package$/m);
  });
});

describe('la unidad systemd', () => {
  const unidad = readFileSync(
    join(RAIZ_REPO, 'packaging', 'linux', 'common', 'krakenos.service'),
    'utf8',
  );
  it('lleva KillMode=process y EnvironmentFile', () => {
    expect(unidad).toMatch(/^KillMode=process$/m);
    expect(unidad).toMatch(/^EnvironmentFile=\/etc\/krakenos\/krakenos\.env$/m);
    expect(unidad).toMatch(/^Environment=KRAKENOS_ENV_FROM_SYSTEM=1$/m);
    expect(unidad).toMatch(/^User=krakenos$/m);
    expect(unidad).toMatch(/^ExecStart=\/usr\/lib\/krakenos\/bin\/krakenos$/m);
    expect(unidad).toMatch(/^WorkingDirectory=\/var\/lib\/krakenos$/m);
  });
});
