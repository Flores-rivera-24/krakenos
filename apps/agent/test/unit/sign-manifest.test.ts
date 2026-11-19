/**
 * `scripts/release/sign-manifest.mjs`: lo que firma el job `release` lo aceptan `parseManifest` y
 * `verifyManifest` (el verificador real del agente). Clave efímera: nunca una real.
 */
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseManifest, verifyManifest } from '../../src/system/update-manifest.js';

const SCRIPT = fileURLToPath(
  new URL('../../../../scripts/release/sign-manifest.mjs', import.meta.url),
);
const FILES = {
  'krakenos_0.3.0_amd64.deb': 'amd64',
  'krakenos_0.3.0_arm64.deb': 'arm64-bytes',
  'krakenos-0.3.0-1-x86_64.pkg.tar.zst': 'arch',
  SHA256SUMS: 'no-es-un-artefacto',
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sign-manifest-'));
  for (const [n, c] of Object.entries(FILES)) writeFileSync(join(dir, n), c);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[], key?: string) {
  const env = { ...process.env };
  delete env.UPDATE_SIGNING_KEY;
  if (key) env.UPDATE_SIGNING_KEY = key;
  return spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8' });
}

describe('sign-manifest.mjs', () => {
  it('escribe un manifiesto y una firma que el verificador del agente acepta', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const r = run([dir, '0.3.0', '0.2.0'], pem);
    expect(r.status, r.stderr).toBe(0);

    const bytes = readFileSync(join(dir, 'manifest.json'));
    const m = parseManifest(bytes);
    expect(m.version).toBe('0.3.0');
    expect(m.minFrom).toBe('0.2.0');
    expect(m.artifacts.map((a) => [a.platform, a.name])).toEqual([
      ['arch-x86_64', 'krakenos-0.3.0-1-x86_64.pkg.tar.zst'],
      ['deb-amd64', 'krakenos_0.3.0_amd64.deb'],
      ['deb-arm64', 'krakenos_0.3.0_arm64.deb'],
    ]);
    const amd = m.artifacts.find((a) => a.platform === 'deb-amd64');
    expect(amd?.sha256).toBe(createHash('sha256').update('amd64').digest('hex'));
    expect(amd?.size).toBe(5);

    const sig = readFileSync(join(dir, 'manifest.json.sig'), 'utf8');
    const pub = publicKey.export({ type: 'spki', format: 'pem' }) as string;
    expect(verifyManifest(bytes, sig, pub)).toBe(true);
    // un byte alterado y la misma firma: rechazo
    expect(verifyManifest(Buffer.from(bytes.toString().replace('0.3.0', '0.3.1')), sig, pub)).toBe(
      false,
    );
  });

  it('minFrom por defecto es 0.2.0', () => {
    const pem = generateKeyPairSync('ed25519').privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    expect(run([dir, '0.3.0'], pem).status).toBe(0);
    expect(parseManifest(readFileSync(join(dir, 'manifest.json'))).minFrom).toBe('0.2.0');
  });

  it('sin UPDATE_SIGNING_KEY falla con un error claro y no escribe nada', () => {
    const r = run([dir, '0.3.0', '0.2.0']);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('UPDATE_SIGNING_KEY');
    expect(() => readFileSync(join(dir, 'manifest.json'))).toThrow();
  });

  it('falla si falta uno de los tres paquetes', () => {
    rmSync(join(dir, 'krakenos_0.3.0_arm64.deb'));
    const pem = generateKeyPairSync('ed25519').privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    const r = run([dir, '0.3.0', '0.2.0'], pem);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('deb-arm64');
  });
});
