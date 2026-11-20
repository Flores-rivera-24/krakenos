import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- script .mjs sin tipos, como los demás de scripts/
import { archivePlan } from '../../../../scripts/package-archive.mjs';

type Plan = { dest: string; cmd: string; args: string[] };
const plan = (dir: string, opts?: { systemRoot?: string }): Plan => archivePlan(dir, opts);
const norm = (s: string) => s.replace(/\\/g, '/');

describe('archivePlan', () => {
  it.each([['linux-x64'], ['linux-arm64']])('%s: tar.gz con dueño root', (id) => {
    const p = plan(`out/krakenos-0.2.0-${id}`);
    expect(norm(p.dest).endsWith(`out/portable/krakenos-0.2.0-${id}.tar.gz`)).toBe(true);
    expect(p.cmd).toBe('tar');
    expect(p.args).toEqual([
      '-czf',
      p.dest,
      '--owner=0',
      '--group=0',
      '-C',
      'out',
      `krakenos-0.2.0-${id}`,
    ]);
  });

  it('win-x64: zip con el bsdtar del sistema', () => {
    const p = plan('out/krakenos-0.2.0-win-x64', { systemRoot: 'D:\\Win' });
    expect(norm(p.dest).endsWith('out/portable/krakenos-0.2.0-win-x64.zip')).toBe(true);
    expect(p.cmd).toBe('D:\\Win\\System32\\tar.exe');
    expect(p.args).toEqual(['-a', '-cf', p.dest, '-C', 'out', 'krakenos-0.2.0-win-x64']);
  });

  it('plataforma desconocida: lanza listando las tres', () => {
    expect(() => plan('out/krakenos-0.2.0-darwin-arm64')).toThrow(
      /win-x64.*linux-x64.*linux-arm64/s,
    );
  });
});

describe.skipIf(process.platform === 'win32')('archivePlan · archivo real (tar)', () => {
  it('conserva modo y enlaces simbólicos, con dueño root', () => {
    const base = mkdtempSync(join(tmpdir(), 'archive-'));
    try {
      const dir = join(base, 'out', 'krakenos-0.0.1-linux-x64');
      mkdirSync(join(dir, 'bin'), { recursive: true });
      writeFileSync(join(dir, 'bin', 'krakenos'), 'x', { mode: 0o755 });
      chmodSync(join(dir, 'bin', 'krakenos'), 0o755);
      symlinkSync('bin/krakenos', join(dir, 'enlace'));
      const p = plan(dir);
      mkdirSync(dirname(p.dest), { recursive: true });
      expect(spawnSync(p.cmd, p.args).status).toBe(0);
      const lista = spawnSync('tar', ['-tvzf', p.dest], { encoding: 'utf8' }).stdout;
      expect(lista).toMatch(
        /^-rwxr-xr-x root\/root .* krakenos-0\.0\.1-linux-x64\/bin\/krakenos$/m,
      );
      expect(lista).toMatch(
        /^l\S+ root\/root .* krakenos-0\.0\.1-linux-x64\/enlace -> bin\/krakenos$/m,
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
