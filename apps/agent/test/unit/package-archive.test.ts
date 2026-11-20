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
