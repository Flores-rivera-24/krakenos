import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { archVersion, renderPkgbuild } from '../../../../scripts/package/arch.mjs';

/** El paquete de Arch (US-294): partes puras, scriptlets de pacman y job de CI. */

const RAIZ = fileURLToPath(new URL('../../../../', import.meta.url));
const ARCH = join(RAIZ, 'packaging', 'linux', 'arch');
const leer = (...p: string[]) => readFileSync(join(RAIZ, ...p), 'utf8');
const WIN = process.platform === 'win32';

describe('archVersion', () => {
  it('una versión estable queda igual', () => {
    expect(archVersion('0.1.0')).toBe('0.1.0');
  });
  it('una prerelease pierde el guion y los puntos (pacman no admite `-`)', () => {
    expect(archVersion('0.1.0-rc.1')).toBe('0.1.0rc1');
    expect(archVersion('0.0.0-ci.1')).toBe('0.0.0ci1');
  });
  it('rechaza lo que pacman no puede versionar', () => {
    expect(() => archVersion('latest')).toThrow(/Versión/);
    expect(() => archVersion('0.1.0-')).toThrow(/Versión/);
  });
});

describe('renderPkgbuild', () => {
  const p: string = renderPkgbuild({ version: '0.1.0rc1', pkgrel: 1, sha256: 'a'.repeat(64) });
  it('lleva nombre, versión, arquitectura y licencia', () => {
    expect(p).toContain('pkgname=krakenos\n');
    expect(p).toContain('pkgver=0.1.0rc1\n');
    expect(p).toContain('pkgrel=1\n');
    expect(p).toContain("arch=('x86_64')\n");
    expect(p).toContain("license=('AGPL-3.0-or-later')\n");
    expect(p).toMatch(/^url='https:\/\//m);
  });
  it('no toca los binarios de Node (!strip) y el árbol viaja en un tar con su suma', () => {
    expect(p).toMatch(/^options=\(.*'!strip'.*\)$/m);
    expect(p).toContain("source=('root.tar')\n");
    expect(p).toContain(`sha256sums=('${'a'.repeat(64)}')\n`);
  });
  it('depende de lo que el binario de Node enlaza y de systemd, y recomienda lo opcional', () => {
    const deps = /^depends=\((.*)\)$/m.exec(p)?.[1] ?? '';
    for (const d of ['systemd', 'glibc', 'gcc-libs', 'ca-certificates'])
      expect(deps).toContain(`'${d}'`);
    const opt = /^optdepends=\(([\s\S]*?)\)$/m.exec(p)?.[1] ?? '';
    for (const d of ['ffmpeg', 'nss-mdns', 'avahi', 'wireguard-tools', 'sudo'])
      expect(opt).toContain(`'${d}:`);
  });
  it('krakenos.env NO es backup: lo crea el scriptlet desde /usr/share y nunca se pisa', () => {
    expect(p).not.toMatch(/^backup=/m);
    expect(p).toContain('install=krakenos.install\n');
  });
  it('package() copia el árbol que makepkg extrajo, sin mirar $startdir (namcap lo marca E)', () => {
    expect(p).toMatch(/package\(\) \{\n\s*cp -a "\$srcdir\/usr" "\$pkgdir\/"\n\}/);
    expect(p).not.toContain('startdir');
  });
  it('no deja marcadores sin sustituir', () => {
    expect(p).not.toMatch(/@[A-Z]+@/);
  });
});

describe('krakenos.install (scriptlets de pacman)', () => {
  const t = readFileSync(join(ARCH, 'krakenos.install'), 'utf8');
  const deb = readFileSync(join(RAIZ, 'packaging', 'linux', 'deb', 'postinst'), 'utf8');

  it.skipIf(WIN)('es bash válido', () => {
    const r = spawnSync('bash', ['-n', join(ARCH, 'krakenos.install')], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('define los tres ganchos', () => {
    for (const f of ['post_install', 'post_upgrade', 'pre_remove'])
      expect(t).toMatch(new RegExp(`^${f}\\(\\) \\{`, 'm'));
  });

  it('sysusers y tmpfiles se llaman a mano: los hooks de pacman corren DESPUÉS del scriptlet', () => {
    expect(t).toContain('systemd-sysusers krakenos.conf');
    expect(t).toContain('systemd-tmpfiles --create krakenos.conf');
  });

  it('crea krakenos.env desde la plantilla solo si no existe y deja HTTPS pendiente', () => {
    expect(t).toMatch(
      /if \[ ! -e \/etc\/krakenos\/krakenos\.env \]; then\s*\n\s*install -m 0600 -o root -g root \/usr\/share\/krakenos\/krakenos\.env \/etc\/krakenos\/krakenos\.env\s*\n\s*touch "\$PENDIENTE"\s*\n\s*fi/,
    );
  });

  it('comparte con el .deb el marcador, los mensajes y las órdenes de root', () => {
    for (const x of [
      'PENDIENTE=/etc/krakenos/.https-pendiente',
      '"$SETUP" tls auto',
      'sudo krakenos-setup tls auto && sudo systemctl enable --now krakenos',
      'sudo krakenos-setup tls none && sudo systemctl enable --now krakenos',
      'SETUP=/usr/lib/krakenos/libexec/krakenos-setup',
      '"$SETUP" setup-url --wait 30 || true',
      'Si aún no creaste el administrador: sudo krakenos-setup setup-url',
      'krakenos-cert.timer',
      'krakenos-cert-local.timer',
    ]) {
      expect(deb, `deb: ${x}`).toContain(x);
      expect(t, `arch: ${x}`).toContain(x);
    }
  });

  it('si tls auto falla en una instalación nueva, no arranca ni habilita el servicio', () => {
    expect(t).toMatch(
      /if ! "\$SETUP" tls auto; then\s*\n\s*touch "\$PENDIENTE"[\s\S]*?return 0\s*\n\s*fi/,
    );
    expect(t).toMatch(/\[ "\$1" = nueva \] \|\| \[ -f "\$PENDIENTE" \]/);
  });

  it('el aviso por stderr y sin arrancar cuando no hay systemd; HTTPS pendiente en instalación nueva', () => {
    const sin = t.slice(t.lastIndexOf('\n  else\n'));
    expect(sin).toMatch(/\[ "\$1" = nueva \][\s\S]*touch "\$PENDIENTE"/);
    expect(sin).toContain('systemd no está en marcha');
    expect(sin).not.toMatch(/systemctl (start|restart|enable)\b(?! --now krakenos)/);
  });

  it('solo espera el enlace de setup en instalación nueva o tras un HTTPS pendiente', () => {
    expect(t.match(/setup-url --wait/g)).toHaveLength(1);
    expect(t).toMatch(/mostrar_url=0/);
  });

  it('reactiva los timers de TLS solo si el servicio NO estaba habilitado (remove + install)', () => {
    expect(t).toMatch(/systemctl is-enabled --quiet krakenos\.service[^\n]*was_enabled=1/);
    expect(t).toMatch(/\[ "\$was_enabled" -eq 0 \] && \[ -f "\/etc\/systemd\/system\/\$t" \]/);
  });

  it('pre_remove para el servicio y los timers, solo si hay systemd', () => {
    const r = t.slice(t.indexOf('pre_remove()'));
    expect(r).toContain('[ -d /run/systemd/system ]');
    for (const u of ['krakenos.service', 'krakenos-cert.timer', 'krakenos-cert-local.timer'])
      expect(r).toContain(`systemctl disable --now ${u}`);
  });

  it('no borra datos ni configuración (pacman no tiene purge: lo dice la guía)', () => {
    expect(t).not.toMatch(/\brm\b/);
  });

  it('no ejecuta nada que viva en /var/lib/krakenos', () => {
    expect(t).not.toMatch(/\/var\/lib\/krakenos\/\S*(sh|mjs|js)\b/);
  });
});

describe('el árbol de código fuente que arma package-arch.mjs', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'kraken-arch-'));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  function paquete(): string {
    const pkg = join(tmp, 'krakenos-0.1.0-linux-x64');
    for (const d of ['bin', 'node/bin', 'app/agent/dist'])
      mkdirSync(join(pkg, d), { recursive: true });
    writeFileSync(join(pkg, 'bin', 'krakenos'), '#!/bin/sh\n', { mode: 0o755 });
    writeFileSync(join(pkg, 'app', 'agent', '.env.example'), 'PORT=3001\n');
    // Uno válido y uno colgante (como el `@krakenos/agent` de pnpm, que apunta a `apps/agent`).
    symlinkSync('krakenos', join(pkg, 'bin', 'alias'));
    symlinkSync('../../../apps/agent', join(pkg, 'app', 'agent', 'dist', 'colgante'));
    return pkg;
  }

  it.skipIf(WIN)('deja PKGBUILD, krakenos.install y root.tar con el árbol y la licencia', () => {
    const out = join(tmp, 'out');
    const r = spawnSync(
      process.execPath,
      [
        join(RAIZ, 'scripts', 'package-arch.mjs'),
        paquete(),
        '--version',
        '0.1.0-rc.1',
        '--out',
        out,
      ],
      { encoding: 'utf8' },
    );
    expect(r.stderr.trim()).toMatch(/^aviso: enlace colgante retirado: \S+colgante$/);
    expect(r.status).toBe(0);
    const dir = r.stdout.trim();
    expect(dir.startsWith(out)).toBe(true);
    const pkgbuild = readFileSync(join(dir, 'PKGBUILD'), 'utf8');
    expect(pkgbuild).toContain('pkgver=0.1.0rc1\n');
    expect(readFileSync(join(dir, 'krakenos.install'), 'utf8')).toContain('post_install()');
    // La suma del PKGBUILD es la del tar que se entrega.
    const suma = createHash('sha256')
      .update(readFileSync(join(dir, 'root.tar')))
      .digest('hex');
    expect(pkgbuild).toContain(`sha256sums=('${suma}')`);
    const ls = spawnSync('tar', ['-tvf', join(dir, 'root.tar')], { encoding: 'utf8' }).stdout;
    expect(ls).toMatch(/-rwxr-xr-x .* usr\/lib\/krakenos\/bin\/krakenos\n/);
    expect(ls).toContain('usr/lib/krakenos/package.env');
    expect(ls).toContain('usr/share/krakenos/krakenos.env');
    expect(ls).toContain('usr/share/licenses/krakenos/LICENSE');
    // Sin /etc: la configuración la crea el scriptlet, no el paquete.
    expect(ls).not.toMatch(/(^| )etc\//m);
    // El enlace válido se conserva; el colgante (namcap lo marca E) se retira.
    expect(ls).toContain('usr/lib/krakenos/bin/alias -> krakenos');
    expect(ls).not.toContain('colgante');
  });

  it.skipIf(WIN)('rechaza una plataforma que no sea linux-x64', () => {
    const pkg = join(tmp, 'krakenos-0.1.0-linux-arm64');
    mkdirSync(pkg, { recursive: true });
    const r = spawnSync(process.execPath, [join(RAIZ, 'scripts', 'package-arch.mjs'), pkg], {
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/linux-x64/);
  });
});

describe('linux-lifecycle.sh (rama arch)', () => {
  const s = leer('scripts', 'package', 'linux-lifecycle.sh');
  it('instala, quita y purga con pacman, y la purga hace lo que dice la guía', () => {
    expect(s).toContain('pacman -U --noconfirm');
    expect(s).toContain('pacman -R --noconfirm krakenos');
    expect(s).toContain('pacman -Rns --noconfirm krakenos');
    // pacman no purga ni borra al usuario de sysusers: lo mismo que manda la guía.
    expect(s).toMatch(/userdel krakenos/);
    expect(s).toMatch(/rm -rf \/var\/lib\/krakenos \/etc\/krakenos/);
    expect(s).toContain('/etc/sudoers.d/krakenos');
  });
  it('las órdenes de purga de la guía son las mismas', () => {
    const g = leer('docs', 'install-linux-package.md');
    for (const c of [
      'pacman -Rns krakenos',
      'userdel krakenos',
      'rm -rf /var/lib/krakenos /etc/krakenos',
    ])
      expect(g, c).toContain(c);
  });
});

describe('ci.yml (job package-arch)', () => {
  const CI = leer('.github', 'workflows', 'ci.yml');
  const ini = CI.indexOf('\n  package-arch:');
  const job = ini < 0 ? '' : CI.slice(ini + 1).split(/\n {2}[a-z][a-z-]*:\n/)[0]!;

  it('shellcheck cubre los scriptlets de pacman', () => {
    expect(CI).toContain('packaging/linux/arch/krakenos.install');
  });

  it('existe', () => {
    expect(ini).toBeGreaterThan(0);
  });

  it('la imagen del contenedor va fijada por digest (la de build y la del ciclo de vida)', () => {
    const imgs = job.match(/archlinux@sha256:[0-9a-f]{64}/g) ?? [];
    expect(imgs.length).toBeGreaterThanOrEqual(2);
    // Nada de `archlinux:latest` ni de etiquetas sueltas.
    expect(job).not.toMatch(/archlinux:(?!.*@sha256)\S+/);
    expect(job).toMatch(/ARCH_BASE_DEVEL: archlinux@sha256:[0-9a-f]{64}\n/);
    expect(job).toMatch(/ARCH_BASE: archlinux@sha256:[0-9a-f]{64}\n/);
  });

  it('construye como usuario no root, pasa namcap y corre el ciclo de vida de arch con systemd', () => {
    expect(job).toMatch(/makepkg/);
    expect(job).toMatch(/namcap/);
    expect(job).toMatch(/linux-lifecycle\.sh arch /);
    expect(job).toMatch(/--privileged/);
    expect(job).toMatch(/--cgroupns=host/);
    expect(job).toMatch(/\/usr\/lib\/systemd\/systemd/);
    expect(job).toMatch(/--version 0\.0\.0-ci\.1/);
    expect(job).toMatch(/useradd|--user/);
  });

  it('el job package sube el paquete de linux-x64 en tar para no perder el bit de ejecución', () => {
    const pkgJob = CI.slice(CI.indexOf('\n  package:'), CI.indexOf('\n  package-arch:'));
    expect(pkgJob).toMatch(/tar -c/);
    expect(pkgJob).toContain('name: krakenos-linux-x64-tar');
    expect(job).toMatch(/download-artifact/);
  });
});
