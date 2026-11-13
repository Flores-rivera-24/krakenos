import { readFileSync } from 'node:fs';
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
    expect(c).toContain('Depends: adduser, systemd, ca-certificates\n');
    expect(c).toContain('Recommends: ffmpeg, libnss-mdns, avahi-daemon\n');
    expect(c).toContain('Suggests: wireguard-tools, sudo\n');
    expect(c).toContain('Installed-Size: 1234\n');
    expect(c).toContain('Architecture: amd64\n');
    expect(c).toMatch(/^Maintainer: .+ <.+@.+>$/m);
    expect(c).toMatch(/^Homepage: https:\/\//m);
    expect(c).toMatch(/^Description: .+\n .+/m);
    expect(c.endsWith('\n')).toBe(true);
  });
  it('Architecture: arm64 para arm64', () => {
    expect(renderControl({ ...base, arch: 'arm64' })).toContain('Architecture: arm64\n');
  });
});

describe('scripts de mantenimiento', () => {
  it('conffiles lista solo /etc/krakenos/krakenos.env', () => {
    expect(leer('conffiles').trim().split('\n')).toEqual(['/etc/krakenos/krakenos.env']);
  });

  it('postinst no falla si setup-url no encuentra el token', () => {
    const l = leer('postinst')
      .split('\n')
      .filter((x) => x.includes('setup-url'));
    expect(l.length).toBeGreaterThan(0);
    for (const x of l) expect(x).toMatch(/\|\| true\s*$/);
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
      expect(x).toMatch(/^\s*rm -rf( \/[\w./-]+)+\s*$/);
      expect(x).not.toMatch(/ \/(\s|$)| \/\*/);
    }
    for (const r of ['/var/lib/krakenos', '/etc/krakenos'])
      expect(rm.some((x) => x.trim().endsWith(r) || x.includes(r + ' '))).toBe(true);
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
