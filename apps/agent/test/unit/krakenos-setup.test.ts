import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  linkSync,
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
import { stageCommonTree } from '../../../../scripts/package/linux-common.mjs';

/**
 * `krakenos-setup` (root, lo que los dos paquetes de Linux instalan). Se ejecuta la COPIA que arma
 * `stageCommonTree` dentro de un `--root` temporal: así se prueba también que carga la biblioteca
 * de su propio directorio y no de otro sitio. Todo con `--dry-run` salvo `setup-url`, que solo lee.
 */

const WIN = process.platform === 'win32';

let raiz: string;
let setup: string;

beforeEach(async () => {
  raiz = mkdtempSync(join(tmpdir(), 'kraken-setup-'));
  const pkg = join(raiz, 'pkg');
  for (const d of ['bin', 'node/bin', 'app/agent/dist'])
    mkdirSync(join(pkg, d), { recursive: true });
  writeFileSync(join(pkg, 'bin', 'krakenos'), '#!/bin/sh\n', { mode: 0o755 });
  writeFileSync(join(pkg, 'node', 'bin', 'node'), 'x', { mode: 0o755 });
  writeFileSync(
    join(pkg, 'app', 'agent', '.env.example'),
    'PORT=3001\nHOST=127.0.0.1\nWEB_ORIGIN=http://localhost:5173\n# WEBAUTHN_RP_ID=krakenos.local\n# WEBAUTHN_ORIGIN=https://krakenos.local:3001\n',
  );
  writeFileSync(join(pkg, 'app', 'agent', 'dist', 'local-ca.js'), '//');
  if (WIN) return;
  await stageCommonTree(pkg, join(raiz, 'root'));
  // Lo que hace el postinst: la plantilla de /usr/share pasa a /etc/krakenos (no es conffile).
  mkdirSync(join(raiz, 'root', 'etc', 'krakenos'), { recursive: true });
  copyFileSync(
    join(raiz, 'root', 'usr', 'share', 'krakenos', 'krakenos.env'),
    join(raiz, 'root', 'etc', 'krakenos', 'krakenos.env'),
  );
  setup = join(raiz, 'root', 'usr', 'lib', 'krakenos', 'libexec', 'krakenos-setup');
});
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

function correr(args: string[], extra: NodeJS.ProcessEnv = {}, timeout = 60000) {
  return spawnSync(setup, ['--root', join(raiz, 'root'), ...args], {
    encoding: 'utf8',
    timeout,
    env: { PATH: '/usr/bin:/bin', ...extra },
  });
}

const dirDatos = () => join(raiz, 'root', 'var', 'lib', 'krakenos');
function dejarToken(contenido = 'abc123\n') {
  mkdirSync(dirDatos(), { recursive: true });
  const f = join(dirDatos(), 'setup-token');
  writeFileSync(f, contenido, { mode: 0o600 });
  return f;
}

describe.skipIf(WIN)('krakenos-setup', () => {
  it('tls auto sin tailscale elige local', () => {
    const r = correr(['--dry-run', 'tls', 'auto'], { KRAKENOS_ASSUME_SYSTEMD: 'yes' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('--tls auto → local');
    expect(r.stdout).toContain('/usr/lib/krakenos/node/bin/node');
    expect(r.stdout).toContain('/usr/lib/krakenos/app/agent/dist/local-ca.js');
    expect(r.stdout).toMatch(
      /WEB_ORIGIN=https:\/\/.+\.local:3001 en .*\/etc\/krakenos\/krakenos\.env/,
    );
    expect(r.stdout).toMatch(/WEBAUTHN_RP_ID=.+\.local en /);
    expect(r.stdout).not.toContain('apt-get');
    expect(r.stdout).not.toContain('useradd');
  });

  describe('modo real: el krakenos.env queda con origen y WebAuthn', () => {
    const envPath = () => join(raiz, 'root', 'etc', 'krakenos', 'krakenos.env');
    const lineas = (clave: string) =>
      readFileSync(envPath(), 'utf8')
        .split('\n')
        .filter((l) => l.startsWith(`${clave}=`));

    /**
     * PATH con un `tailscale` (status y cert) y, para correr sin ser root de verdad, un `id -u` que
     * dice 0 y un `install`/`chgrp` que ignoran propietario y grupo.
     */
    function stubs(): string {
      const bin = join(raiz, 'stubs');
      mkdirSync(bin);
      const f = (n: string, c: string) =>
        writeFileSync(join(bin, n), `#!/bin/sh\n${c}\n`, { mode: 0o755 });
      f(
        'tailscale',
        'if [ "$1" = cert ]; then\n  while [ $# -gt 0 ]; do\n    case "$1" in --cert-file|--key-file) : > "$2"; shift;; esac\n    shift\n  done\n  exit 0\nfi\necho \'{"Self":{"DNSName": "casa.tailnet-abc.ts.net."}}\'',
      );
      f('id', '[ "$1" = -u ] && { echo 0; exit 0; }\nexec /usr/bin/id "$@"');
      f('chgrp', 'exit 0');
      f(
        'install',
        'a=""\nwhile [ $# -gt 0 ]; do\n  case "$1" in -o|-g) shift;; *) a="$a \'$1\'";; esac\n  shift\ndone\neval exec /usr/bin/install $a',
      );
      return `${bin}:/usr/bin:/bin`;
    }

    it('tls tailscale, aunque el .env no traiga las claves de plantilla ni un origen con puerto', () => {
      // Un krakenos.env editado: sin los comentarios de WebAuthn y con el origen viejo, sin puerto.
      writeFileSync(envPath(), 'PORT=3001\nWEB_ORIGIN=https://x.ts.net\n');
      const path = stubs();
      const r = correr(['tls', 'tailscale'], { KRAKENOS_ASSUME_SYSTEMD: 'no', PATH: path });
      expect(r.status, r.stderr).toBe(0);
      const origen = 'https://casa.tailnet-abc.ts.net:3001';
      expect(lineas('WEB_ORIGIN')).toEqual([`WEB_ORIGIN=${origen}`]);
      expect(lineas('WEBAUTHN_RP_ID')).toEqual(['WEBAUTHN_RP_ID=casa.tailnet-abc.ts.net']);
      expect(lineas('WEBAUTHN_ORIGIN')).toEqual([`WEBAUTHN_ORIGIN=${origen}`]);
      // Reejecutar no duplica nada.
      const otra = correr(['tls', 'tailscale'], { KRAKENOS_ASSUME_SYSTEMD: 'no', PATH: path });
      expect(otra.status, otra.stderr).toBe(0);
      expect(lineas('WEB_ORIGIN')).toHaveLength(1);
      expect(lineas('WEBAUTHN_ORIGIN')).toHaveLength(1);
    });

    it('tls local fija WebAuthn aunque el .env no traiga la plantilla', () => {
      // En seco (la CA real exige root y node de verdad): se comprueba lo que escribiría.
      writeFileSync(envPath(), 'PORT=3001\n');
      const r = correr(['--dry-run', 'tls', 'local']);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toMatch(/WEBAUTHN_RP_ID=[a-z0-9-]+\.local en /);
      expect(r.stdout).toMatch(/WEBAUTHN_ORIGIN=https:\/\/[a-z0-9-]+\.local:3001 en /);
    });
  });

  it('tls dice cómo arrancar el servicio cuando no está habilitado', () => {
    const r = correr(['--dry-run', 'tls', 'local'], { KRAKENOS_ASSUME_SYSTEMD: 'yes' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/Habilita y arranca el servicio: systemctl enable --now krakenos$/m);
  });

  it('tls pide solo reiniciar cuando el servicio ya está habilitado', () => {
    const bin = join(raiz, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const r = correr(['--dry-run', 'tls', 'local'], {
      KRAKENOS_ASSUME_SYSTEMD: 'yes',
      PATH: `${bin}:/usr/bin:/bin`,
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('systemctl restart krakenos');
    expect(r.stdout).not.toMatch(/enable --now krakenos$/m);
  });

  it('tls borra el marcador de HTTPS pendiente al terminar bien, también con none; --dry-run no', () => {
    const marcador = join(raiz, 'root', 'etc', 'krakenos', '.https-pendiente');
    writeFileSync(marcador, '');
    const seco = correr(['--dry-run', 'tls', 'none']);
    expect(seco.status, seco.stderr).toBe(0);
    expect(existsSync(marcador)).toBe(true);
    const r = correr(['tls', 'none']);
    expect(r.status, r.stderr).toBe(0);
    expect(existsSync(marcador)).toBe(false);
  });

  it('tls conserva el marcador de HTTPS pendiente cuando falla', () => {
    const marcador = join(raiz, 'root', 'etc', 'krakenos', '.https-pendiente');
    writeFileSync(marcador, '');
    // Sin Tailscale en el PATH de prueba, `tls tailscale` muere antes de terminar.
    const r = correr(['tls', 'tailscale']);
    expect(r.status).not.toBe(0);
    expect(existsSync(marcador)).toBe(true);
  });

  it('tls none avisa de lo que se pierde', () => {
    const r = correr(['--dry-run', 'tls', 'none']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(
      /NO funcionan la app instalable \(PWA\), los avisos push ni las passkeys/,
    );
  });

  it('--with-helper valida con visudo -cf', () => {
    const r = correr(['--dry-run', '--with-helper']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('validado con visudo -cf');
    expect(r.stdout).toContain('/etc/sudoers.d/krakenos');
  });

  it('--with-helper crea /etc/wireguard (0700) y reinicia el servicio si hay systemd', () => {
    // ReadWritePaths=-/etc/wireguard se ignora si la ruta no existía al arrancar la unidad.
    const r = correr(['--dry-run', '--with-helper'], { KRAKENOS_ASSUME_SYSTEMD: 'yes' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/dry-run\$ install -d -m 0700 -o root -g root .*\/etc\/wireguard\n/);
    expect(r.stdout).toContain('dry-run$ systemctl try-restart krakenos');
    expect(r.stdout.indexOf('/etc/wireguard')).toBeLessThan(r.stdout.indexOf('try-restart'));
  });

  it('--with-helper sin systemd no intenta reiniciar nada', () => {
    const r = correr(['--dry-run', '--with-helper'], { KRAKENOS_ASSUME_SYSTEMD: 'no' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('/etc/wireguard');
    expect(r.stdout).not.toContain('try-restart');
  });

  it('un modo de TLS desconocido es un error', () => {
    const r = correr(['--dry-run', 'tls', 'raro']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('raro');
  });

  it('un modo de TLS inválido falla aunque el orden sea otro', () => {
    const r = correr(['--dry-run', 'auto', 'tls']);
    expect(r.status).toBe(2);
    expect(r.stdout).not.toContain('--tls auto');
  });

  it('setup-url imprime la URL con el token', () => {
    dejarToken('abc123\n');
    const r = correr(['setup-url', '--wait', '1']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toMatch(/ http:\/\/localhost:3001\/setup\?token=abc123$/);
  });

  it('setup-url respeta un WEB_ORIGIN https ya configurado', () => {
    dejarToken('abc123\n');
    writeFileSync(
      join(raiz, 'root', 'etc', 'krakenos', 'krakenos.env'),
      'WEB_ORIGIN=https://casa.local:3001\n',
    );
    const r = correr(['setup-url', '--wait', '1']);
    expect(r.stdout.trim()).toMatch(/ https:\/\/casa\.local:3001\/setup\?token=abc123$/);
  });

  it('setup-url rechaza enlace simbólico y enlace duro', () => {
    const secreto = join(raiz, 'secreto');
    writeFileSync(secreto, 'CONTENIDO-AJENO\n');
    const destino = join(dirDatos(), 'setup-token');
    mkdirSync(dirDatos(), { recursive: true });

    symlinkSync(secreto, destino);
    let r = correr(['setup-url', '--wait', '1']);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toContain('CONTENIDO-AJENO');
    expect(r.stdout).not.toContain('token=');
    rmSync(destino);

    linkSync(secreto, destino);
    r = correr(['setup-url', '--wait', '1']);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).not.toContain('CONTENIDO-AJENO');
    expect(r.stdout).not.toContain('token=');
  });

  it('setup-url no se cuelga con un FIFO en el lugar del token ni imprime nada', () => {
    mkdirSync(dirDatos(), { recursive: true });
    expect(spawnSync('mkfifo', [join(dirDatos(), 'setup-token')]).status).toBe(0);
    const r = correr(['setup-url', '--wait', '1'], {}, 20000);
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('token=');
  });

  it('setup-url sin fichero termina 0 y nombra journalctl', () => {
    const r = correr(['setup-url', '--wait', '1']);
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toContain('journalctl -u krakenos');
  });
});
