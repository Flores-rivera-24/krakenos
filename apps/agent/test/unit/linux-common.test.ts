import {
  chmodSync,
  existsSync,
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
import { HELPER_PATH, renderEnvFile, renderPackageEnv, stageCommonTree } from '../../../../scripts/package/linux-common.mjs';
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

  it('conserva HOST (elección del usuario) y NO lleva activas las claves que fija el paquete', () => {
    const out: string = renderEnvFile(PLANTILLA);
    expect(out).toMatch(/^HOST=0\.0\.0\.0$/m);
    expect(out.match(/^HOST=/gm)).toHaveLength(1);
    expect(out).toContain('PORT=3001');
    // Ni una sola línea activa de las claves del paquete: el usuario las cambiaría sin efecto (o peor).
    for (const k of Object.keys(PACKAGE_ENV_ESPERADO))
      expect(out, k).not.toMatch(new RegExp(`^${k}=`, 'm'));
    expect(out).toMatch(/^# .*package\.env/m);
  });
});

/** Claves que son del paquete y no del usuario (rutas del paquete y modo de despliegue). */
const PACKAGE_ENV_ESPERADO: Record<string, string> = {
  KRAKENOS_DATA_DIR: '/var/lib/krakenos',
  KRAKENOS_DEPLOY_MODE: 'package',
  WG_HELPER_PATH: '/usr/lib/krakenos/libexec/krakenos-helper',
  FW_HELPER_PATH: '/usr/lib/krakenos/libexec/krakenos-helper',
  TC_HELPER_PATH: '/usr/lib/krakenos/libexec/krakenos-helper',
};

describe('renderPackageEnv: las claves que el usuario no debe poder romper', () => {
  it('lleva exactamente las claves del paquete, una vez cada una, y nada más', () => {
    const out: string = renderPackageEnv();
    const activas = out.split('\n').filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l));
    expect(Object.fromEntries(activas.map((l) => l.split(/=(.*)/s).slice(0, 2)))).toEqual(
      PACKAGE_ENV_ESPERADO,
    );
    expect(activas).toHaveLength(Object.keys(PACKAGE_ENV_ESPERADO).length);
  });

  it('no lleva HOST ni PORT (son del usuario), ni secretos, ni comentarios de fin de línea', () => {
    const out: string = renderPackageEnv();
    expect(out).not.toMatch(/^(HOST|PORT)=/m);
    expect(out).not.toMatch(/SECRET|PASSWORD|TOKEN|KEY=/i);
    for (const l of out.split('\n').filter((x) => /^[A-Za-z_]/.test(x)))
      expect(l).not.toMatch(/\s#/);
  });
});

describe('renderEnvFile: comentarios de fin de línea', () => {
  // systemd `EnvironmentFile=` no los entiende y los deja dentro del valor.
  it('la plantilla real no deja ninguna línea activa con comentario al final', () => {
    const real = readFileSync(join(RAIZ_REPO, 'apps', 'agent', '.env.example'), 'utf8');
    const out: string = renderEnvFile(real);
    const activas = out.split('\n').filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l));
    expect(activas.length).toBeGreaterThan(10);
    for (const l of activas) expect(l, l).not.toMatch(/\s#|\s$/);
    expect(out).toMatch(/^MIKROTIK_WAN_IFACE=ether1$/m);
    expect(out).toMatch(/^ACCESS_TOKEN_TTL=900$/m);
    // Las líneas de comentario completas y las comentadas no se tocan.
    expect(out).toContain('# WEB_DIST_PATH=../web/dist   # ruta al build');
  });

  it('un # pegado al valor o dentro de comillas no se corta', () => {
    const out: string = renderEnvFile('A=x#y   # c\nB="a # b"  # c\nC=\'q # r\'\n');
    expect(out).toMatch(/^A=x#y$/m);
    expect(out).toMatch(/^B="a # b" {2}# c$/m);
    expect(out).toMatch(/^C='q # r'$/m);
  });
});

describe('el helper privilegiado en el paquete', () => {
  const PLANTILLA_HELPER = `${PLANTILLA}WG_HELPER_PATH=/usr/local/bin/krakenos-helper\nFW_HELPER_PATH=/usr/local/bin/krakenos-helper\nTC_HELPER_PATH=/usr/local/bin/krakenos-helper\n`;

  it('el archivo del paquete apunta las tres variables al helper del paquete', () => {
    const out: string = renderPackageEnv();
    expect(HELPER_PATH).toBe('/usr/lib/krakenos/libexec/krakenos-helper');
    for (const k of ['WG', 'FW', 'TC']) expect(out).toContain(`${k}_HELPER_PATH=${HELPER_PATH}\n`);
    expect(out).not.toContain('/usr/local/bin');
    // El del usuario ya no las lleva activas, ni siquiera con la plantilla vieja.
    expect(renderEnvFile(PLANTILLA_HELPER)).not.toMatch(/^[WFT][GWC]_HELPER_PATH=/m);
  });

  it('la plantilla real fija las tres variables y la regla de sudoers usa la MISMA ruta', () => {
    const real = readFileSync(join(RAIZ_REPO, 'apps', 'agent', '.env.example'), 'utf8');
    expect(renderEnvFile(real)).not.toMatch(/^[WFT][GWC]_HELPER_PATH=/m);
    const setup = readFileSync(
      join(RAIZ_REPO, 'packaging', 'linux', 'common', 'krakenos-setup'),
      'utf8',
    );
    expect(setup).toContain(`HELPER_PATH=${HELPER_PATH}\n`);
    expect(setup).toMatch(/NOPASSWD: \$HELPER_PATH/);
  });

  it.skipIf(WIN)('stageCommonTree instala el helper en esa ruta', async () => {
    const root = join(raiz, 'root');
    await stageCommonTree(paqueteFalso(), root);
    expect(lstatSync(join(root, HELPER_PATH)).mode & 0o777).toBe(0o755);
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
    // Plantilla sin secretos (el postinst la copia a /etc/krakenos con 0600): nada de /etc en el paquete.
    expect(modo('usr/share/krakenos/krakenos.env')).toBe(0o644);
    expect(existsSync(join(root, 'etc'))).toBe(false);
    expect(lstatSync(join(root, 'usr/bin/krakenos-setup')).isSymbolicLink()).toBe(true);
    for (const f of [
      'usr/lib/systemd/system/krakenos.service',
      'usr/lib/sysusers.d/krakenos.conf',
      'usr/lib/tmpfiles.d/krakenos.conf',
      'usr/lib/krakenos/bin/krakenos',
    ])
      expect(lstatSync(join(root, f)).isFile(), f).toBe(true);
    // Las claves del paquete, aparte y de root: el usuario no las toca editando krakenos.env.
    expect(modo('usr/lib/krakenos/package.env')).toBe(0o644);
    expect(readFileSync(join(root, 'usr/lib/krakenos/package.env'), 'utf8')).toBe(
      renderPackageEnv(),
    );
    const env = readFileSync(join(root, 'usr/share/krakenos/krakenos.env'), 'utf8');
    expect(env).not.toMatch(/^KRAKENOS_DEPLOY_MODE=/m);
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
    // El último archivo gana en systemd: el del paquete va DESPUÉS del del usuario para blindar sus claves.
    // (`Environment=` no sirve: `EnvironmentFile=` lo pisa.)
    const archivos = unidad.match(/^EnvironmentFile=.*$/gm);
    expect(archivos).toEqual([
      'EnvironmentFile=/etc/krakenos/krakenos.env',
      'EnvironmentFile=/usr/lib/krakenos/package.env',
    ]);
    expect(unidad).toMatch(/^Environment=KRAKENOS_ENV_FROM_SYSTEM=1$/m);
    expect(unidad).toMatch(/^User=krakenos$/m);
    // wg-quick save (vía sudo) hereda ProtectSystem=full y escribiría /etc/wireguard en solo lectura.
    expect(unidad).toMatch(/^ReadWritePaths=-\/etc\/wireguard$/m);
    expect(unidad).toMatch(/^ExecStart=\/usr\/lib\/krakenos\/bin\/krakenos$/m);
    expect(unidad).toMatch(/^WorkingDirectory=\/var\/lib\/krakenos$/m);
  });
});
