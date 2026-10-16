import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Tests del instalador de un comando (US-216) en modo `--dry-run`: el plan se
 * imprime sin mutar el sistema (cada mutación sale como `dry-run$ …`), así que
 * aquí se verifica el CONTRATO del script — orden de pasos, flags, honestidad
 * del uninstall y las comprobaciones de plataforma — sin root ni red.
 * La instalación real se verifica en CI (job installer-smoke) y en el
 * despliegue del usuario (checklist US-86).
 */
const SCRIPT = fileURLToPath(new URL('../../../../scripts/install.sh', import.meta.url));

/** Plataforma soportada simulada; MIN_* a 1 para que RAM/disco reales pasen. */
const SUPPORTED_ENV = {
  KRAKENOS_OS_ID: 'debian',
  KRAKENOS_ARCH: 'x86_64',
  KRAKENOS_MIN_RAM_MB: '1',
  KRAKENOS_MIN_DISK_MB: '1',
  // Los tests no dependen de que el runner tenga systemd: se asume que sí salvo que
  // el caso diga lo contrario.
  KRAKENOS_ASSUME_SYSTEMD: 'yes',
};

function runInstaller(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    execFile(
      'bash',
      [SCRIPT, ...args],
      { env: { ...process.env, ...SUPPORTED_ENV, ...env } },
      (err, stdout, stderr) => {
        const code =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? (err as { code: number }).code
            : 0;
        resolvePromise({ code, stdout, stderr });
      },
    );
  });
}

describe('install.sh --dry-run (US-216)', () => {
  it('imprime el plan completo en orden: pnpm pinneado → clone → keys → build → migrate (aplicador propio) → systemd', async () => {
    const { code, stdout } = await runInstaller(['--dry-run', '--yes', '--dir', '/tmp/kraken-x']);
    expect(code).toBe(0);
    const order = [
      'corepack prepare pnpm@9.12.0 --activate', // pinneado, patrón AUD-27
      'git clone',
      'gen-keys.sh',
      'pnpm install --frozen-lockfile',
      'pnpm build',
      'dist/migrate.js', // aplicador propio de migraciones (US-275), no la CLI de Prisma
      'systemctl enable --now krakenos',
    ];
    let last = -1;
    for (const step of order) {
      const at = stdout.indexOf(step);
      expect(at, `falta el paso «${step}» en el plan`).toBeGreaterThan(last);
      last = at;
    }
    expect(stdout).not.toContain('prisma migrate deploy');
    // Nada se ejecuta de verdad: toda mutación va marcada como dry-run.
    expect(stdout).toContain('dry-run$');
  });

  it('--no-service omite systemd y explica el arranque manual', async () => {
    const { code, stdout } = await runInstaller([
      '--dry-run',
      '--yes',
      '--no-service',
      '--dir',
      '/tmp/kraken-x',
    ]);
    expect(code).toBe(0);
    expect(stdout).not.toContain('systemctl enable');
    expect(stdout).not.toContain('useradd');
    expect(stdout).toContain('Arranque manual');
  });

  it('sin systemd no falla: omite servicio y timers, avisa y lo dice en el resumen', async () => {
    const { code, stdout, stderr } = await runInstaller(
      ['--dry-run', '--yes', '--dir', '/tmp/kraken-x'],
      { KRAKENOS_ASSUME_SYSTEMD: 'no', KRAKENOS_ASSUME_WSL: 'no' },
    );
    expect(code).toBe(0);
    expect(stderr).toContain('no tiene systemd');
    expect(stdout).not.toContain('systemctl');
    expect(stdout).not.toContain('useradd');
    expect(stdout).toContain('Servicio systemd omitido (este sistema no tiene systemd)');
    expect(stdout).toContain('NODE_ENV=production node dist/index.js');
    expect(stdout).toContain('sin systemd: no hay servicio');
  });

  it('sin systemd en WSL explica cómo activarlo', async () => {
    const { code, stdout, stderr } = await runInstaller(
      ['--dry-run', '--yes', '--dir', '/tmp/kraken-x'],
      { KRAKENOS_ASSUME_SYSTEMD: 'no', KRAKENOS_ASSUME_WSL: 'yes' },
    );
    expect(code).toBe(0);
    expect(stderr).toContain('/etc/wsl.conf');
    expect(stderr).toContain('wsl --shutdown');
    expect(stdout).toContain('sin systemd (WSL)');
    expect(stdout).not.toContain('systemctl');
  });

  it('sin systemd tampoco programa los timers de renovación TLS y lo declara', async () => {
    const { code, stdout } = await runInstaller(
      ['--dry-run', '--yes', '--tls', 'local', '--dir', '/tmp/kraken-x'],
      { KRAKENOS_ASSUME_SYSTEMD: 'no', KRAKENOS_ASSUME_WSL: 'no' },
    );
    expect(code).toBe(0);
    expect(stdout).not.toContain('systemctl');
    expect(stdout).not.toMatch(/\.timer/);
    expect(stdout).toContain('el certificado local NO se renovará solo');
  });

  it('--from-local copia el árbol local (sin node_modules) en vez de clonar', async () => {
    const { code, stdout } = await runInstaller([
      '--dry-run',
      '--yes',
      '--no-service',
      '--dir',
      '/tmp/kraken-x',
      '--from-local',
      process.cwd(),
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('--exclude=node_modules');
    // La copia jamás hereda secretos ni estado del árbol de origen.
    for (const secret of ['--exclude=.env', '--exclude=keys', '--exclude=data']) {
      expect(stdout).toContain(secret);
    }
    expect(stdout).not.toContain('git clone');
  });

  it('--dir se respeta en todo el plan', async () => {
    const { stdout } = await runInstaller(['--dry-run', '--yes', '--dir', '/srv/mi-kraken']);
    expect(stdout).toContain('→ /srv/mi-kraken');
    expect(stdout).toContain('/srv/mi-kraken/apps/agent');
  });

  it('rechaza un SO no soportado con un mensaje honesto (no un stacktrace)', async () => {
    const { code, stderr } = await runInstaller(['--dry-run'], { KRAKENOS_OS_ID: 'fedora' });
    expect(code).toBe(1);
    expect(stderr).toContain('SO no soportado');
    expect(stderr).toContain('instalación manual');
  });

  it('rechaza una arquitectura de 32 bits', async () => {
    const { code, stderr } = await runInstaller(['--dry-run'], { KRAKENOS_ARCH: 'armv7l' });
    expect(code).toBe(1);
    expect(stderr).toContain('arquitectura no soportada');
  });

  it('rechaza RAM insuficiente con la cota configurada', async () => {
    const { code, stderr } = await runInstaller(['--dry-run'], {
      KRAKENOS_MIN_RAM_MB: '99999999',
    });
    expect(code).toBe(1);
    expect(stderr).toContain('RAM insuficiente');
  });

  it('--uninstall sin --purge conserva y ENUMERA los datos (DB, keys, data)', async () => {
    const { code, stdout } = await runInstaller([
      '--dry-run',
      '--yes',
      '--uninstall',
      '--dir',
      '/tmp/kraken-x',
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('systemctl disable --now krakenos');
    expect(stdout).toContain('Se conserva /tmp/kraken-x');
    expect(stdout).toContain('prisma/*.db');
    expect(stdout).toContain('keys/');
    expect(stdout).toContain('data/');
    // Sin purge, jamás aparece un rm -rf del directorio como acción.
    expect(stdout).not.toContain('dry-run$ rm -rf /tmp/kraken-x');
    // Y se retira la regla sudoers que el instalador puso (no deja residuos).
    expect(stdout).toContain('/etc/sudoers.d/krakenos-update');
  });

  it('--update reusa el orquestador de US-190 (update-runner one-shot)', async () => {
    // Sobre este mismo repo (tiene .git), el plan debe delegar en update-runner.
    const { code, stdout } = await runInstaller([
      '--dry-run',
      '--yes',
      '--update',
      '--dir',
      fileURLToPath(new URL('../../../..', import.meta.url)),
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('node dist/update-runner.js');
    expect(stdout).toContain('rollback');
  });

  it('--update sube Node si el instalado es anterior (y lo hace ANTES de lanzar el actualizador)', async () => {
    // Un `node` de mentira que dice ser v20: obliga a la rama de instalación.
    const shimDir = mkdtempSync(join(tmpdir(), 'kraken-node-shim-'));
    const shim = join(shimDir, 'node');
    writeFileSync(shim, '#!/bin/sh\necho v20.19.0\n');
    chmodSync(shim, 0o755);
    const { code, stdout } = await runInstaller(
      [
        '--dry-run',
        '--yes',
        '--update',
        '--dir',
        fileURLToPath(new URL('../../../..', import.meta.url)),
      ],
      { PATH: `${shimDir}:${process.env.PATH ?? ''}` },
    );
    expect(code).toBe(0);
    const nodeStep = stdout.indexOf('deb.nodesource.com/setup_24.x');
    expect(nodeStep).toBeGreaterThan(-1);
    expect(stdout).toContain('apt-get install -y -qq nodejs');
    expect(nodeStep).toBeLessThan(stdout.indexOf('node dist/update-runner.js'));
  });

  it('--update con el Node ya al día no reinstala nada', async () => {
    const { code, stdout } = await runInstaller([
      '--dry-run',
      '--yes',
      '--update',
      '--dir',
      fileURLToPath(new URL('../../../..', import.meta.url)),
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('Node.js ≥ 24');
    expect(stdout).not.toContain('deb.nodesource.com');
  });

  // US-232 (AUD3-23): en `curl | sudo bash` no hay TTY, así que el viejo `confirm()`
  // respondía «no» SIEMPRE y la instalación se quedaba sin cámaras ni VPN en
  // silencio. Ahora los extras van por bandera y lo omitido se dice en voz alta.
  it('sin banderas de extras: no instala ninguno y AVISA de lo que queda desactivado', async () => {
    const { code, stdout } = await runInstaller(['--dry-run', '--yes', '--dir', '/tmp/kraken-x']);
    expect(code).toBe(0);
    // Ninguna instalación de extras en el plan (el resumen final SÍ los nombra,
    // que es justo lo que se quiere: avisar de lo que falta).
    expect(stdout).not.toContain('install -y -qq ffmpeg');
    expect(stdout).not.toContain('krakenos-helper');
    expect(stdout).not.toContain('pnpm add');
    expect(stdout).toContain('Qué quedó FUERA');
    for (const missing of ['--with-helper', '--with-ffmpeg', '--with-deps', '--with-all']) {
      expect(stdout, `el resumen debe señalar ${missing}`).toContain(missing);
    }
  });

  it('--with-all instala los tres extras, pero con --tls none el TLS sigue faltando y se avisa', async () => {
    const { code, stdout } = await runInstaller([
      '--dry-run',
      '--yes',
      '--with-all',
      '--tls',
      'none',
      '--dir',
      '/tmp/kraken-x',
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('krakenos-helper');
    expect(stdout).toContain('ffmpeg');
    expect(stdout).toContain('pnpm add node-ssh mqtt net-snmp ws');
    // El manifiesto que el actualizador reinstala tras cada update (AUD3-22).
    expect(stdout).toContain('extra-deps.json');
    // US-241: el TLS NO es un extra más — `--with-all` no lo incluye a propósito,
    // porque implica elegir entre Tailscale y autofirmado. Y sin él se dice qué
    // deja de funcionar, en vez de dar la instalación por completa.
    expect(stdout).toContain('Qué quedó FUERA');
    expect(stdout).toContain('sin HTTPS');
  });

  // HTTPS por defecto: sin --tls y sin Tailscale con sesión, el instalador monta la
  // CA local en vez de dejar la instalación en HTTP plano.
  it('sin --tls y sin Tailscale elige «local» y lo dice', async () => {
    const { code, stdout } = await runInstaller(['--dry-run', '--yes', '--dir', '/tmp/kraken-x'], {
      // PATH sin tailscale aunque la máquina de desarrollo lo tenga.
      PATH: '/usr/bin:/bin',
    });
    expect(code).toBe(0);
    expect(stdout).toContain('--tls auto → local');
    expect(stdout).toContain('gen-local-ca.sh');
    expect(stdout).toContain('HTTPS_ENABLED=true');
    expect(stdout).toContain('TLS_CA_CERT_PATH=/etc/krakenos/tls/krakenos-ca.pem');
    expect(stdout).toMatch(/WEB_ORIGIN=https:\/\/[a-z0-9-]+\.local:3001/);
    expect(stdout).toContain('install -d -o root -g root -m 0700 /etc/krakenos/ca');
    expect(stdout).toContain('avahi-daemon');
    expect(stdout).toContain('krakenos-cert-local.timer');
    expect(stdout).toContain('/api/system/ca-cert');
    expect(stdout).toContain('Confianza de certificados');
    expect(stdout).not.toContain('sin HTTPS');
  });

  it('--tls local deja la instalación sin nada que avisar salvo instalar la CA', async () => {
    const { code, stdout } = await runInstaller([
      '--dry-run',
      '--yes',
      '--with-all',
      '--tls',
      'local',
      '--dir',
      '/tmp/kraken-x',
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain('gen-local-ca.sh');
    expect(stdout).toContain('instalar UNA vez el certificado de la CA');
  });

  it('--tls self sigue funcionando como alias OBSOLETO de local', async () => {
    const { code, stdout, stderr } = await runInstaller([
      '--dry-run',
      '--yes',
      '--tls',
      'self',
      '--dir',
      '/tmp/kraken-x',
    ]);
    expect(code).toBe(0);
    expect(stderr).toContain('obsoleto');
    expect(stdout).toContain('gen-local-ca.sh');
    expect(stdout).not.toContain('gen-cert.sh');
  });

  it('--tls none sigue instalando sobre HTTP, y lo avisa', async () => {
    const { code, stdout } = await runInstaller([
      '--dry-run',
      '--yes',
      '--tls',
      'none',
      '--dir',
      '/tmp/kraken-x',
    ]);
    expect(code).toBe(0);
    expect(stdout).not.toContain('gen-local-ca.sh');
    expect(stdout).not.toContain('HTTPS_ENABLED=true');
    expect(stdout).toContain('sin HTTPS');
  });

  it('--tls tailscale se PARA si Tailscale no está listo, en vez de dejarlo a medias', async () => {
    // Degradar en silencio a HTTP dejaría al usuario creyendo que tiene HTTPS.
    const { code, stdout, stderr } = await runInstaller([
      '--dry-run',
      '--yes',
      '--tls',
      'tailscale',
      '--dir',
      '/tmp/kraken-x',
    ]);
    const salida = stdout + stderr;
    if (code !== 0) {
      expect(salida).toContain('Tailscale');
    } else {
      // Si el entorno SÍ tiene tailscale, debe haber emitido el certificado.
      expect(salida).toContain('tailscale cert');
    }
  });

  it('--tls rechaza un valor que no existe', async () => {
    const { code, stderr } = await runInstaller(['--dry-run', '--tls', 'lo-que-sea']);
    expect(code).not.toBe(0);
    expect(stderr).toContain('--tls admite');
  });

  it('cada extra se activa por separado', async () => {
    const only = async (flag: string) =>
      (await runInstaller(['--dry-run', '--yes', flag, '--dir', '/tmp/kraken-x'])).stdout;
    const ffmpeg = await only('--with-ffmpeg');
    expect(ffmpeg).toContain('ffmpeg');
    expect(ffmpeg).not.toContain('krakenos-helper');
    const helper = await only('--with-helper');
    expect(helper).toContain('krakenos-helper');
    expect(helper).not.toContain('install -y -qq ffmpeg');
  });

  it('endurece los permisos de los secretos (AUD3-06: .env y la DB quedaban a 0644)', async () => {
    const { stdout } = await runInstaller(['--dry-run', '--yes', '--dir', '/tmp/kraken-x']);
    expect(stdout).toContain('chmod 600 /tmp/kraken-x/apps/agent/.env');
    expect(stdout).toMatch(/chmod 600 .*keys/);
    expect(stdout).toMatch(/chmod 600 .*\.db/);
  });

  it('instala la regla sudoers de restart VALIDADA (sin ella el update se revierte siempre)', async () => {
    const { stdout } = await runInstaller(['--dry-run', '--yes', '--dir', '/tmp/kraken-x']);
    expect(stdout).toContain('/etc/sudoers.d/krakenos-update');
    // Nunca se instala sin validar: un sudoers roto rompe `sudo` en toda la máquina.
    expect(stdout).toContain('visudo -cf');
  });

  it('la unidad systemd lleva KillMode=process (sin él el actualizador se suicida)', async () => {
    // En dry-run el unit no se escribe, pero el plan sí nombra el fichero; el
    // contenido se verifica sobre la plantilla versionada.
    const { stdout } = await runInstaller(['--dry-run', '--yes', '--dir', '/tmp/kraken-x']);
    expect(stdout).toContain('/etc/systemd/system/krakenos.service');
    const unit = readFileSync(
      fileURLToPath(new URL('../../scripts/krakenos.service.example', import.meta.url)),
      'utf8',
    );
    expect(unit).toMatch(/^KillMode=process$/m);
  });

  it('el pipe de NodeSource corre con pipefail (si no, degrada a Node 18 en silencio)', () => {
    const script = readFileSync(SCRIPT, 'utf8');
    const nodesource = script.split('\n').find((l) => l.includes('deb.nodesource.com'));
    expect(nodesource).toBeDefined();
    expect(nodesource).toContain('set -o pipefail');
  });

  it('rechaza rutas con metacaracteres o relativas (se interpolan en bash -c)', async () => {
    for (const dir of ["/tmp/kraken'x", '/tmp/kraken x', 'relativa/kraken', '/tmp/kraken$HOME']) {
      const { code, stderr } = await runInstaller(['--dry-run', '--yes', '--dir', dir]);
      expect(code, `debería rechazar «${dir}»`).toBe(1);
      expect(stderr).toContain('ruta no válida');
    }
  });

  it('una opción desconocida falla con ayuda, no ejecuta nada', async () => {
    const { code, stderr } = await runInstaller(['--dry-run', '--frobnicar']);
    expect(code).toBe(1);
    expect(stderr).toContain('opción desconocida');
  });
});

/**
 * Root nunca ejecuta ni escribe nada que el usuario del servicio pueda modificar.
 *
 * El árbol de instalación es del usuario del servicio (`chown -R`). Los timers de
 * renovación corren como root: si su `ExecStart` apuntaba a un script de ese árbol,
 * un agente comprometido lo editaba y obtenía root al mes siguiente; y un
 * `ExecStartPost=chown` sobre rutas suyas seguía enlaces simbólicos (`ln -sf
 * /etc/shadow agent-key.pem`). Estos tests habrían cazado ambas cosas.
 */
describe('install.sh · root no ejecuta lo que el servicio puede modificar', () => {
  const INSTALL_DIR = '/tmp/kraken-x';

  /** Unidades de renovación que el plan escribe, con su contenido (`dry-run>`). */
  function unitsDeRenovacion(stdout: string): { path: string; body: string }[] {
    const out: { path: string; body: string }[] = [];
    const lines = stdout.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^dry-run\$ write (\/etc\/systemd\/system\/\S*-cert\S*\.(?:service|timer))$/.exec(
        lines[i] ?? '',
      );
      if (!m) continue;
      const body: string[] = [];
      while ((lines[i + 1] ?? '').startsWith('dry-run>')) body.push((lines[++i] ?? '').slice(11));
      out.push({ path: m[1] ?? '', body: body.join('\n') });
    }
    return out;
  }

  /** Un `tailscale` falso que responde como un nodo con MagicDNS. */
  function tailscaleFalso(): string {
    const dir = mkdtempSync(join(tmpdir(), 'kraken-ts-'));
    const bin = join(dir, 'tailscale');
    writeFileSync(bin, '#!/bin/sh\necho \'{"Self":{"DNSName": "casa.tailnet-abc.ts.net."}}\'\n');
    chmodSync(bin, 0o755);
    return dir;
  }

  function comprobar(stdout: string, esperaUnidad: string) {
    const units = unitsDeRenovacion(stdout);
    const service = units.find((u) => u.path.endsWith(`${esperaUnidad}.service`));
    expect(service, `falta la unidad ${esperaUnidad}.service en el plan`).toBeDefined();
    for (const u of units) {
      // Ninguna unidad ejecuta nada bajo el árbol de instalación…
      expect(u.body, u.path).not.toContain(INSTALL_DIR);
      // …ni hace chown (que sigue enlaces) sobre rutas que el servicio controla.
      expect(u.body, u.path).not.toMatch(/ExecStartPost=.*chown/);
    }
    const execStart = /^ExecStart=(.*)$/m.exec(service?.body ?? '')?.[1] ?? '';
    return execStart;
  }

  it('modo local: el timer ejecuta la copia de root y todo el TLS vive en /etc/krakenos', async () => {
    const { code, stdout } = await runInstaller([
      '--dry-run',
      '--yes',
      '--tls',
      'local',
      '--dir',
      INSTALL_DIR,
    ]);
    expect(code).toBe(0);
    const execStart = comprobar(stdout, 'krakenos-cert-local');
    expect(execStart).toBe('/usr/bin/env bash /usr/local/lib/krakenos/gen-local-ca.sh');
    expect(stdout).toContain('Environment=KRAKENOS_CERTS_DIR=/etc/krakenos/tls');
    expect(stdout).toContain('Environment=KRAKENOS_KEYS_DIR=/etc/krakenos/ca');
    // La copia de root, con dueño y modo explícitos, en un directorio de root.
    expect(stdout).toContain('install -d -o root -g root -m 0755 /usr/local/lib/krakenos');
    expect(stdout).toContain(
      `install -o root -g root -m 0755 ${INSTALL_DIR}/apps/agent/scripts/gen-local-ca.sh /usr/local/lib/krakenos/gen-local-ca.sh`,
    );
    // El servicio lee por grupo: dir 0750 root:servicio, la CA en un dir 0700 de root.
    expect(stdout).toContain('install -d -o root -g krakenos -m 0750 /etc/krakenos/tls');
    expect(stdout).toContain('install -d -o root -g root -m 0700 /etc/krakenos/ca');
    for (const v of ['TLS_CERT_PATH', 'TLS_KEY_PATH', 'TLS_CA_CERT_PATH']) {
      expect(stdout).toMatch(new RegExp(`${v}=/etc/krakenos/tls/\\S+ en`));
    }
    expect(stdout).not.toMatch(/TLS_\w+_PATH=\.\/certs/);
  });

  it('modo tailscale: renueva escribiendo en /etc/krakenos/tls, sin chown', async () => {
    const bin = tailscaleFalso();
    const { code, stdout } = await runInstaller(
      ['--dry-run', '--yes', '--tls', 'tailscale', '--dir', INSTALL_DIR],
      { PATH: `${bin}:/usr/bin:/bin` },
    );
    expect(code).toBe(0);
    const execStart = comprobar(stdout, 'krakenos-cert');
    expect(execStart).toContain('tailscale cert');
    expect(execStart).toContain('--cert-file /etc/krakenos/tls/agent-cert.pem');
    expect(execStart).toContain('--key-file /etc/krakenos/tls/agent-key.pem');
    expect(stdout).toMatch(/TLS_KEY_PATH=\/etc\/krakenos\/tls\/agent-key\.pem en/);
    expect(stdout).not.toMatch(/chown.*\/etc\/krakenos/);
  });

  it('auto elige tailscale si hay Tailscale con sesión, y lo dice', async () => {
    const bin = tailscaleFalso();
    const { stdout } = await runInstaller(['--dry-run', '--yes', '--dir', INSTALL_DIR], {
      PATH: `${bin}:/usr/bin:/bin`,
    });
    expect(stdout).toContain('--tls auto → tailscale');
    expect(stdout).not.toContain('gen-local-ca.sh');
  });

  it('--update migra el certificado de la ruta vieja a /etc/krakenos/tls y reescribe el .env', async () => {
    // Instalación antigua: Tailscale con el material en apps/agent/certs.
    const dir = mkdtempSync(join(tmpdir(), 'kraken-mig-'));
    execFileSync('git', ['init', '-q', dir]);
    mkdirSync(join(dir, 'apps/agent/certs'), { recursive: true });
    writeFileSync(join(dir, 'apps/agent/certs/agent-cert.pem'), 'x');
    writeFileSync(join(dir, 'apps/agent/certs/agent-key.pem'), 'x');
    writeFileSync(
      join(dir, 'apps/agent/.env'),
      'HTTPS_ENABLED=true\nTLS_CERT_PATH=./certs/agent-cert.pem\n',
    );
    const { code, stdout } = await runInstaller(['--dry-run', '--yes', '--update', '--dir', dir], {
      KRAKENOS_SERVICE_USER: userInfo().username,
    });
    expect(code).toBe(0);
    expect(stdout).toContain('migrando el certificado');
    expect(stdout).toContain(
      'mv -f /etc/krakenos/tls/agent-key.pem.nuevo /etc/krakenos/tls/agent-key.pem',
    );
    expect(stdout).toContain('chmod 0640 /etc/krakenos/tls/agent-key.pem.nuevo');
    expect(stdout).toContain('TLS_CERT_PATH=/etc/krakenos/tls/agent-cert.pem');
    expect(stdout).toContain('TLS_KEY_PATH=/etc/krakenos/tls/agent-key.pem');
    expect(stdout).toContain('TLS migrado');
  });

  it('--update NO migra un enlace simbólico (un enlace a /etc/shadow no se vuelve legible)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kraken-mig-ln-'));
    execFileSync('git', ['init', '-q', dir]);
    mkdirSync(join(dir, 'apps/agent/certs'), { recursive: true });
    writeFileSync(join(dir, 'apps/agent/certs/agent-cert.pem'), 'x');
    symlinkSync('/etc/shadow', join(dir, 'apps/agent/certs/agent-key.pem'));
    const { stdout, stderr } = await runInstaller(
      ['--dry-run', '--yes', '--update', '--dir', dir],
      {
        KRAKENOS_SERVICE_USER: userInfo().username,
      },
    );
    expect(stdout + stderr).toContain('TLS NO migrado');
    expect(stdout).not.toContain('agent-key.pem.nuevo');
  });

  it('--update NO migra un enlace DURO (pasa -f y ! -L, pero apunta a un fichero de root)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kraken-mig-hl-'));
    execFileSync('git', ['init', '-q', dir]);
    mkdirSync(join(dir, 'apps/agent/certs'), { recursive: true });
    writeFileSync(join(dir, 'apps/agent/certs/agent-cert.pem'), 'x');
    const objetivo = join(dir, 'objetivo');
    writeFileSync(objetivo, 'secreto');
    linkSync(objetivo, join(dir, 'apps/agent/certs/agent-key.pem'));
    const { stdout, stderr } = await runInstaller(
      ['--dry-run', '--yes', '--update', '--dir', dir],
      {
        KRAKENOS_SERVICE_USER: userInfo().username,
      },
    );
    expect(stdout + stderr).toContain('TLS NO migrado');
    expect(stdout).not.toContain('agent-key.pem.nuevo');
    // Y no se movió NADA: el certificado tampoco (no queda el par partido).
    expect(stdout).not.toContain('agent-cert.pem.nuevo');
  });

  it('--update NO migra un fichero de otro propietario', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kraken-mig-own-'));
    execFileSync('git', ['init', '-q', dir]);
    mkdirSync(join(dir, 'apps/agent/certs'), { recursive: true });
    writeFileSync(join(dir, 'apps/agent/certs/agent-cert.pem'), 'x');
    writeFileSync(join(dir, 'apps/agent/certs/agent-key.pem'), 'x');
    // El servicio "es" otro usuario distinto del dueño de los ficheros.
    const { stdout, stderr } = await runInstaller(
      ['--dry-run', '--yes', '--update', '--dir', dir],
      {
        KRAKENOS_SERVICE_USER: 'nadie-que-exista',
      },
    );
    expect(stdout + stderr).toContain('TLS NO migrado');
    expect(stdout).not.toContain('.nuevo');
  });
});
