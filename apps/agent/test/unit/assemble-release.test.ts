/**
 * `scripts/release/assemble.mjs`: reúne los cinco archivos de la release (dos .deb, el paquete de Arch y
 * los dos portables de Linux) y escribe SHA256SUMS. Si falta alguno no deja nada a medias.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = fileURLToPath(new URL('../../../../scripts/release/assemble.mjs', import.meta.url));
const V = '0.3.0';
// Bytes distintos por archivo: una suma cruzada entre nombres se vería.
const CINCO: Record<string, string> = {
  [`krakenos_${V}_amd64.deb`]: 'deb-amd64',
  [`krakenos_${V}_arm64.deb`]: 'deb-arm64-bytes',
  [`krakenos-${V}-1-x86_64.pkg.tar.zst`]: 'arch',
  [`krakenos-${V}-linux-x64.tar.gz`]: 'tar-x64',
  [`krakenos-${V}-linux-arm64.tar.gz`]: 'tar-arm64-xx',
};

let raiz: string;
let dl: string;
let out: string;
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'assemble-release-'));
  dl = join(raiz, 'dl');
  out = join(raiz, 'release');
  mkdirSync(dl);
  for (const [n, c] of Object.entries(CINCO)) writeFileSync(join(dl, n), c);
});
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

const run = () => spawnSync(process.execPath, [SCRIPT, dl, out, V], { encoding: 'utf8' });

describe('assemble.mjs', () => {
  it('caso feliz: copia los cinco archivos y SHA256SUMS lleva cinco sumas correctas, en orden alfabético', () => {
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(out).sort()).toEqual([...Object.keys(CINCO), 'SHA256SUMS'].sort());
    const lineas = readFileSync(join(out, 'SHA256SUMS'), 'utf8').trimEnd().split('\n');
    expect(lineas).toHaveLength(5);
    const nombres = lineas.map((l) => l.slice(66));
    expect(nombres).toEqual([...nombres].sort());
    for (const l of lineas) {
      const nombre = l.slice(66);
      expect(l.slice(0, 66)).toBe(
        `${createHash('sha256')
          .update(CINCO[nombre] as string)
          .digest('hex')}  `,
      );
    }
  });

  it('falta un portable: exit 1, el mensaje nombra el archivo y no hay SHA256SUMS', () => {
    rmSync(join(dl, `krakenos-${V}-linux-arm64.tar.gz`));
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`krakenos-${V}-linux-arm64.tar.gz`);
    expect(existsSync(join(out, 'SHA256SUMS'))).toBe(false);
  });

  it('lista TODOS los que faltan, no solo el primero', () => {
    rmSync(join(dl, `krakenos_${V}_amd64.deb`));
    rmSync(join(dl, `krakenos-${V}-linux-x64.tar.gz`));
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`krakenos_${V}_amd64.deb`);
    expect(r.stderr).toContain(`krakenos-${V}-linux-x64.tar.gz`);
  });

  it('falta el paquete de Arch: falla', () => {
    rmSync(join(dl, `krakenos-${V}-1-x86_64.pkg.tar.zst`));
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('pkg.tar.zst');
  });

  it('un paquete de Arch que no es x86_64 no cuenta como el de Arch', () => {
    rmSync(join(dl, `krakenos-${V}-1-x86_64.pkg.tar.zst`));
    writeFileSync(join(dl, `krakenos-${V}-1-aarch64.pkg.tar.zst`), 'otro');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('pkg.tar.zst');
  });

  it('dos paquetes de Arch: falla', () => {
    writeFileSync(join(dl, `krakenos-${V}-2-x86_64.pkg.tar.zst`), 'otro');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('pkg.tar.zst');
    expect(existsSync(join(out, 'SHA256SUMS'))).toBe(false);
  });

  it('el manifiesto, la firma y un SHA256SUMS previos de la descarga no se cuelan', () => {
    for (const n of [
      'manifest.json',
      'manifest.json.sig',
      'SHA256SUMS',
      'krakenos-0.2.0-linux-x64.tar.gz',
    ])
      writeFileSync(join(dl, n), 'viejo');
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(out).sort()).toEqual([...Object.keys(CINCO), 'SHA256SUMS'].sort());
    expect(readFileSync(join(out, 'SHA256SUMS'), 'utf8')).not.toContain('viejo');
    expect(readFileSync(join(out, 'SHA256SUMS'), 'utf8')).not.toContain('0.2.0');
  });
});
