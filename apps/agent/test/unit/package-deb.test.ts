import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { debArch, debFileName, debVersion, renderControl } from '../../../../scripts/package/deb.mjs';

/** El .deb (US-287): partes puras y texto de los scripts de mantenimiento que ejecuta root. */

const DEB = fileURLToPath(new URL('../../../../packaging/linux/deb/', import.meta.url));
const leer = (f: string) => readFileSync(DEB + f, 'utf8');

describe('debArch', () => {
  it('traduce linux-x64 y linux-arm64', () => {
    expect(debArch('linux-x64')).toBe('amd64');
    expect(debArch('linux-arm64')).toBe('arm64');
  });
  it('lanza con win-x64', () => {
    expect(() => debArch('win-x64')).toThrow(/win-x64/);
  });
});

describe('debVersion', () => {
  it('semver estable queda igual y una prerelease usa ~', () => {
    expect(debVersion('0.1.0')).toBe('0.1.0');
    expect(debVersion('0.1.0-rc.1')).toBe('0.1.0~rc.1');
  });
  it('debFileName', () => {
    expect(debFileName('0.1.0', 'amd64')).toBe('krakenos_0.1.0_amd64.deb');
  });
});

describe('renderControl', () => {
  const base = { version: '0.1.0', arch: 'amd64', installedSizeKb: 1234 };
  it('lleva las dependencias, el tamaño y la arquitectura', () => {
    const c = renderControl(base);
    expect(c).toContain('Package: krakenos\n');
    expect(c).toContain('Version: 0.1.0\n');
    expect(c).toContain(
      'Depends: adduser, systemd, ca-certificates, libc6, libstdc++6, libgcc-s1\n',
    );
    expect(c).toContain('Recommends: ffmpeg, libnss-mdns, avahi-daemon\n');
    expect(c).toContain('Suggests: wireguard-tools, sudo\n');
    expect(c).toContain('Installed-Size: 1234\n');
    expect(c).toContain('Architecture: amd64\n');
    expect(c).toContain(
      'Maintainer: José Luis Flores Rivera <31547366+Flores-rivera-24@users.noreply.github.com>\n',
    );
    expect(c).toMatch(/^Homepage: https:\/\//m);
    expect(c).toMatch(/^Description: .+\n .+/m);
    expect(c.endsWith('\n')).toBe(true);
  });
  it('Architecture: arm64 para arm64', () => {
    expect(renderControl({ ...base, arch: 'arm64' })).toContain('Architecture: arm64\n');
  });
});

it('la regla de sudoers que borra postrm es la que escribe krakenos-setup', () => {
  const setup = readFileSync(DEB + '../common/krakenos-setup', 'utf8');
  expect(setup).toContain('install_sudoers "$ROOT/etc/sudoers.d/krakenos"');
});

describe('scripts de mantenimiento', () => {
  it('no hay conffiles: krakenos.env lo crea postinst desde /usr/share, antes que nada', () => {
    // Si lo fuera, `tls auto` lo modifica en toda instalación y dpkg preguntaría en cada versión.
    expect(existsSync(DEB + 'conffiles')).toBe(false);
    const t = leer('postinst');
    const cfg = t.slice(t.indexOf('configure)'));
    expect(cfg).toMatch(
      /configure\)(\s*\n\s*#.*)*\s*\n\s*install -d -m 0755 \/etc\/krakenos\s*\n\s*if \[ ! -e \/etc\/krakenos\/krakenos\.env \]; then\s*\n\s*install -m 0600 -o root -g root \/usr\/share\/krakenos\/krakenos\.env \/etc\/krakenos\/krakenos\.env\s*\n\s*fi\s*\n\s*systemd-sysusers/,
    );
  });

  it('postinst no falla si setup-url no encuentra el token', () => {
    const l = leer('postinst')
      .split('\n')
      .filter((x) => x.includes('"$SETUP" setup-url'));
    expect(l.length).toBeGreaterThan(0);
    for (const x of l) expect(x).toMatch(/\|\| true\s*$/);
  });

  it('postinst: si tls auto falla en una instalación nueva, no arranca ni pide setup-url', () => {
    const t = leer('postinst');
    // Instalación nueva O marcador de un intento fallido anterior: una actualización no arranca sin HTTPS.
    expect(t).toMatch(
      /if \[ -z "\$2" \] \|\| \[ -f "\$PENDIENTE" \]; then\s*\n\s*if ! "\$SETUP" tls auto; then[\s\S]*?exit 0\s*\n\s*fi\s*\n\s*mostrar_url=1\s*\n\s*fi[\s\S]*systemctl restart[\s\S]*setup-url/,
    );
    expect(t).toContain('PENDIENTE=/etc/krakenos/.https-pendiente');
    // El marcador se crea ANTES del exit 0 del fallo.
    expect(t).toMatch(/touch "\$PENDIENTE"[\s\S]*?exit 0/);
    expect(t).toContain('sudo krakenos-setup tls auto');
    expect(t).toContain('sudo systemctl enable --now krakenos');
    expect(t).toContain('sudo krakenos-setup tls none');
  });

  it('postinst: solo espera el enlace de setup en instalación nueva o tras un HTTPS pendiente', () => {
    const t = leer('postinst');
    expect(t).toMatch(/mostrar_url=0/);
    expect(t).toMatch(
      /if \[ "\$mostrar_url" -eq 1 \]; then\s*\n\s*"\$SETUP" setup-url --wait 30 \|\| true/,
    );
    // En una actualización normal: una línea, sin espera ni token posiblemente caducado.
    expect(t).toContain('Si aún no creaste el administrador: sudo krakenos-setup setup-url');
    expect(t.match(/setup-url --wait/g)).toHaveLength(1);
  });

  it('postinst: un systemctl que falla lo dice por stderr antes de salir con error', () => {
    const t = leer('postinst');
    for (const c of ['enable krakenos.service', 'restart krakenos.service'])
      expect(t).toMatch(new RegExp(`systemctl ${c} \\|\\| \\{[^}]*>&2[^}]*exit 1`));
  });

  it('postinst: reactiva los timers de TLS que prerm deshabilitó (remove sin purge y reinstalar)', () => {
    const t = leer('postinst');
    for (const timer of ['krakenos-cert.timer', 'krakenos-cert-local.timer'])
      expect(t).toContain(timer);
    // Solo si el servicio NO estaba habilitado antes (remove): una actualización no toca los timers.
    expect(t).toMatch(/systemctl is-enabled --quiet krakenos\.service[^\n]*was_enabled=1/);
    expect(t.indexOf('was_enabled=1')).toBeLessThan(t.indexOf('systemctl enable krakenos.service'));
    expect(t).toMatch(
      /\[ "\$was_enabled" -eq 0 \] && \[ -f "\/etc\/systemd\/system\/\$t" \][\s\S]*systemctl enable --now "\$t"/,
    );
    // Tras `systemctl restart krakenos` y antes del enlace de setup.
    expect(t.indexOf('enable --now "$t"')).toBeGreaterThan(t.indexOf('restart krakenos.service'));
  });

  it('los tres scripts son POSIX sh con set -e', () => {
    for (const f of ['postinst', 'prerm', 'postrm']) {
      const t = leer(f);
      expect(t.startsWith('#!/bin/sh\n')).toBe(true);
      expect(t).toMatch(/^set -e$/m);
      expect(t).not.toMatch(/\[\[|bash/);
    }
  });

  it('postinst no ejecuta nada que viva en /var/lib/krakenos ni en el árbol del servicio', () => {
    const t = leer('postinst');
    expect(t).not.toMatch(/\/var\/lib\/krakenos\/\S*(sh|mjs|js)\b/);
    expect(t).toContain('/usr/lib/krakenos/libexec/krakenos-setup');
  });

  it('postrm purge borra solo rutas literales y deluser sin fallar', () => {
    const t = leer('postrm');
    const rm = t.split('\n').filter((x) => /\brm\b/.test(x));
    expect(rm.length).toBeGreaterThan(0);
    for (const x of rm) {
      expect(x).not.toContain('$');
      expect(x).toMatch(/^\s*rm -(rf|f)( \/[\w./-]+)+\s*$/);
      expect(x).not.toMatch(/ \/(\s|$)| \/\*/);
    }
    for (const r of ['/var/lib/krakenos', '/etc/krakenos'])
      expect(rm.some((x) => x.trim().endsWith(r) || x.includes(r + ' '))).toBe(true);
    // Un fichero suelto se borra con rm -f; solo los dos directorios llevan -r.
    for (const x of rm.filter((l) => /\.(service|timer)$|sudoers/.test(l)))
      expect(x).toMatch(/rm -f /);
    expect(rm.map((x) => x.trim())).toContain('rm -f /etc/sudoers.d/krakenos');
    // /etc/krakenos entero (rm -rf) se lleva también el marcador de HTTPS pendiente.
    expect(rm.map((x) => x.trim())).toContain('rm -rf /etc/krakenos');
    expect(t).toMatch(/deluser --system krakenos.*\|\| true/);
    expect(t).toMatch(/purge\)/);
  });

  it('prerm remove desactiva el servicio y los timers de TLS', () => {
    const t = leer('prerm');
    expect(t).toMatch(/remove\)/);
    for (const u of ['krakenos', 'krakenos-cert.timer', 'krakenos-cert-local.timer'])
      expect(t).toContain(u);
  });
});

describe('ci.yml (job package)', () => {
  const CI = readFileSync(
    fileURLToPath(new URL('../../../../.github/workflows/ci.yml', import.meta.url)),
    'utf8',
  );
  const job = CI.slice(CI.indexOf('\n  package:'), CI.indexOf('\n  e2e:'));

  it('prueba el ciclo de vida en las dos arquitecturas', () => {
    expect(job).toContain('linux-x64');
    expect(job).toContain('linux-arm64');
    expect(job).toMatch(/startsWith\(matrix\.target, 'linux-'\)/);
    expect(job).toMatch(/--version 0\.0\.0~ci1/);
    expect(job).toMatch(/lintian --fail-on error/);
    expect(job).toMatch(/sudo scripts\/package\/linux-lifecycle\.sh deb /);
  });
});
