import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  artifactFor,
  checkUpgrade,
  parseManifest,
  verifyManifest,
  type Manifest,
} from '../../src/system/update-manifest.js';
import { UpdateBlockedError } from '../../src/system/node-requirement.js';

const pem = (k: ReturnType<typeof generateKeyPairSync>['publicKey']) =>
  k.export({ type: 'spki', format: 'pem' }).toString();

const manifest: Manifest = {
  schema: 1,
  version: '0.3.0',
  minFrom: '0.2.0',
  artifacts: [
    { platform: 'deb-amd64', name: 'krakenos_0.3.0_amd64.deb', sha256: 'a'.repeat(64), size: 10 },
    {
      platform: 'arch-x86_64',
      name: 'krakenos-0.3.0.pkg.tar.zst',
      sha256: 'b'.repeat(64),
      size: 20,
    },
  ],
};
const bytes = Buffer.from(JSON.stringify(manifest));

describe('verifyManifest', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const sigB64 = sign(null, bytes, privateKey).toString('base64');

  it('acepta la firma válida', () => {
    expect(verifyManifest(bytes, sigB64, pem(publicKey))).toBe(true);
  });
  it('rechaza un byte cambiado', () => {
    const t = Buffer.from(bytes);
    t[10] = t[10]! ^ 1;
    expect(verifyManifest(t, sigB64, pem(publicKey))).toBe(false);
  });
  it('rechaza la firma de otra clave', () => {
    const otra = generateKeyPairSync('ed25519').publicKey;
    expect(verifyManifest(bytes, sigB64, pem(otra))).toBe(false);
  });
  it('rechaza base64 roto, firma vacía y clave ilegible sin lanzar', () => {
    expect(verifyManifest(bytes, '%%%no-base64', pem(publicKey))).toBe(false);
    expect(verifyManifest(bytes, '', pem(publicKey))).toBe(false);
    expect(verifyManifest(bytes, sigB64, 'no-es-un-secreto')).toBe(false);
  });
});

describe('parseManifest', () => {
  it('parsea un manifiesto válido', () => {
    expect(parseManifest(bytes)).toEqual(manifest);
  });
  const malos: Array<[string, unknown]> = [
    ['no es JSON', undefined],
    ['schema distinto', { ...manifest, schema: 2 }],
    ['versión mal formada', { ...manifest, version: '1.2' }],
    ['minFrom mal formada', { ...manifest, minFrom: 'x' }],
    [
      'plataforma desconocida',
      { ...manifest, artifacts: [{ ...manifest.artifacts[0], platform: 'win' }] },
    ],
    ['sha256 corto', { ...manifest, artifacts: [{ ...manifest.artifacts[0], sha256: 'abc' }] }],
    ['tamaño no positivo', { ...manifest, artifacts: [{ ...manifest.artifacts[0], size: 0 }] }],
    [
      'nombre con ruta',
      { ...manifest, artifacts: [{ ...manifest.artifacts[0], name: '../x.deb' }] },
    ],
    ['sin artefactos', { ...manifest, artifacts: [] }],
    [
      'plataforma repetida',
      { ...manifest, artifacts: [manifest.artifacts[0], manifest.artifacts[0]] },
    ],
    ['campo extra', { ...manifest, extra: 1 }],
  ];
  it.each(malos)('rechaza: %s', (_n, v) => {
    const b = v === undefined ? Buffer.from('{no') : Buffer.from(JSON.stringify(v));
    expect(() => parseManifest(b)).toThrow(/manifiesto/i);
  });
});

describe('checkUpgrade', () => {
  it('deja pasar una versión más nueva desde minFrom', () => {
    expect(() => checkUpgrade(manifest, '0.2.0')).not.toThrow();
    expect(() => checkUpgrade(manifest, '0.2.9')).not.toThrow();
  });
  it.each(['0.3.0', '0.3.1', '1.0.0'])('rechaza igual o downgrade (instalada %s)', (v) => {
    expect(() => checkUpgrade(manifest, v)).toThrow(UpdateBlockedError);
  });
  it('rechaza si la instalada es menor que minFrom', () => {
    expect(() => checkUpgrade(manifest, '0.1.0')).toThrow(UpdateBlockedError);
  });
});

describe('artifactFor', () => {
  it('devuelve el artefacto de la plataforma', () => {
    expect(artifactFor(manifest, 'arch-x86_64').name).toBe('krakenos-0.3.0.pkg.tar.zst');
  });
  it('lanza si no hay artefacto para la plataforma', () => {
    expect(() => artifactFor(manifest, 'deb-arm64')).toThrow(UpdateBlockedError);
  });
});
