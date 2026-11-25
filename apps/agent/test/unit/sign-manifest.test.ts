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
  'krakenos-0.3.0-linux-x64.tar.gz': 'portable-x64',
  'krakenos-0.3.0-linux-arm64.tar.gz': 'portable-arm64',
  'KrakenOS-Setup-0.3.0-x64.exe': 'exe-bytes',
  SHA256SUMS: 'no-es-un-artefacto',
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sign-manifest-'));
  for (const [n, c] of Object.entries(FILES)) writeFileSync(join(dir, n), c);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[], key?: string, publica?: string) {
  const env = { ...process.env };
  delete env.UPDATE_SIGNING_KEY;
  delete env.UPDATE_VERIFY_PUBLIC_KEY;
  if (key) env.UPDATE_SIGNING_KEY = key;
  // Solo pruebas: la clave pública real tiene su privada en el secreto de CI, que aquí no existe.
  if (publica) env.UPDATE_VERIFY_PUBLIC_KEY = publica;
  return spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8' });
}

describe('sign-manifest.mjs', () => {
  it('escribe un manifiesto y una firma que el verificador del agente acepta', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
    const r = run(
      [dir, '0.3.0', '0.2.0'],
      pem,
      publicKey.export({ type: 'spki', format: 'pem' }) as string,
    );
    expect(r.status, r.stderr).toBe(0);

    const bytes = readFileSync(join(dir, 'manifest.json'));
    const m = parseManifest(bytes);
    expect(m.version).toBe('0.3.0');
    expect(m.minFrom).toBe('0.2.0');
    expect(m.artifacts.map((a) => [a.platform, a.name])).toEqual([
      ['arch-x86_64', 'krakenos-0.3.0-1-x86_64.pkg.tar.zst'],
      ['deb-amd64', 'krakenos_0.3.0_amd64.deb'],
      ['deb-arm64', 'krakenos_0.3.0_arm64.deb'],
      ['win-x64', 'KrakenOS-Setup-0.3.0-x64.exe'],
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

  it('los portables de la carpeta de release no entran al manifiesto: el actualizador solo instala paquetes (.deb/Arch) y el instalador de Windows', () => {
    const par = generateKeyPairSync('ed25519');
    const r = run(
      [dir, '0.3.0'],
      par.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
      par.publicKey.export({ type: 'spki', format: 'pem' }) as string,
    );
    expect(r.status, r.stderr).toBe(0);
    const m = parseManifest(readFileSync(join(dir, 'manifest.json')));
    expect(m.artifacts.map((a) => a.platform).sort()).toEqual([
      'arch-x86_64',
      'deb-amd64',
      'deb-arm64',
      'win-x64',
    ]);
  });

  it('minFrom por defecto es 0.2.0', () => {
    const par = generateKeyPairSync('ed25519');
    const r = run(
      [dir, '0.3.0'],
      par.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
      par.publicKey.export({ type: 'spki', format: 'pem' }) as string,
    );
    expect(r.status, r.stderr).toBe(0);
    expect(parseManifest(readFileSync(join(dir, 'manifest.json'))).minFrom).toBe('0.2.0');
  });

  it('una privada que NO casa con la pública embebida falla y no deja manifiesto ni firma', () => {
    const pem = generateKeyPairSync('ed25519').privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    const r = run([dir, '0.3.0', '0.2.0'], pem); // sin override: la clave pública REAL del agente
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/no corresponde a la clave pública embebida/);
    expect(() => readFileSync(join(dir, 'manifest.json'))).toThrow();
    expect(() => readFileSync(join(dir, 'manifest.json.sig'))).toThrow();
  });

  it('una clave que no es ed25519 se rechaza', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    const r = run([dir, '0.3.0', '0.2.0'], rsa);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/ed25519/);
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

  it('exige el .exe: sin KrakenOS-Setup-*-x64.exe falla nombrando win-x64', () => {
    rmSync(join(dir, 'KrakenOS-Setup-0.3.0-x64.exe'));
    const pem = generateKeyPairSync('ed25519').privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    const r = run([dir, '0.3.0', '0.2.0'], pem);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('win-x64');
  });

  it('--plataformas win-x64 firma solo el .exe y el verificador lo acepta', () => {
    const par = generateKeyPairSync('ed25519');
    const pub = par.publicKey.export({ type: 'spki', format: 'pem' }) as string;
    for (const f of Object.keys(FILES).filter((f) => f.startsWith('krakenos')))
      rmSync(join(dir, f)); // el .exe es lo único que hay
    const r = run(
      [dir, '0.3.0', '0.2.0', '--plataformas', 'win-x64'],
      par.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
      pub,
    );
    expect(r.status, r.stderr).toBe(0);
    const bytes = readFileSync(join(dir, 'manifest.json'));
    expect(parseManifest(bytes).artifacts.map((a) => a.platform)).toEqual(['win-x64']);
    expect(verifyManifest(bytes, readFileSync(join(dir, 'manifest.json.sig'), 'utf8'), pub)).toBe(
      true,
    );
  });

  it('--plataformas con una plataforma desconocida falla nombrándola', () => {
    const pem = generateKeyPairSync('ed25519').privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;
    const r = run([dir, '0.3.0', '0.2.0', '--plataformas', 'mac-arm64'], pem);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('mac-arm64');
  });
});
