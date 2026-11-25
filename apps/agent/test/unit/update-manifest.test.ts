import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  artifactFor,
  checkUpgrade,
  parseManifest,
  verifyAndParse,
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

describe('hallazgos de la revisión de la Task 1', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const sigOf = (b: Buffer) => sign(null, b, privateKey).toString('base64');

  it('verifyAndParse devuelve el manifiesto solo con firma válida', () => {
    expect(verifyAndParse(bytes, sigOf(bytes), pem(publicKey))).toEqual(manifest);
  });
  it('verifyAndParse rechaza con BAD_SIGNATURE ANTES de parsear (JSON roto con firma mala)', () => {
    const roto = Buffer.from('{no');
    expect(() => verifyAndParse(roto, sigOf(bytes), pem(publicKey))).toThrow(
      expect.objectContaining({ code: 'BAD_SIGNATURE' }),
    );
  });
  it('verifyAndParse: firma válida de un JSON inválido sigue siendo inválido', () => {
    const roto = Buffer.from('{no');
    expect(() => verifyAndParse(roto, sigOf(roto), pem(publicKey))).toThrow(/manifiesto/i);
  });

  it.each(['01.2.3', '1.02.3', '1.2.03', '1234567890.0.0', '1.2.3-rc1'])(
    'rechaza la versión %s',
    (v) => {
      expect(() => parseManifest(Buffer.from(JSON.stringify({ ...manifest, version: v })))).toThrow(
        /manifiesto/i,
      );
    },
  );
  it('acepta 0.0.0 y 9 dígitos', () => {
    expect(() =>
      parseManifest(Buffer.from(JSON.stringify({ ...manifest, version: '999999999.0.0' }))),
    ).not.toThrow();
    expect(() =>
      parseManifest(Buffer.from(JSON.stringify({ ...manifest, minFrom: '0.0.0' }))),
    ).not.toThrow();
  });

  it('minFrom tiene su propio código y la igualdad exacta pasa', () => {
    expect(() => checkUpgrade(manifest, '0.1.0')).toThrow(
      expect.objectContaining({ code: 'MIN_FROM' }),
    );
    expect(() => checkUpgrade(manifest, '0.2.0')).not.toThrow();
  });

  const conNombre = (name: string) =>
    Buffer.from(JSON.stringify({ ...manifest, artifacts: [{ ...manifest.artifacts[0], name }] }));
  it.each([
    ['sin extensión de paquete', 'krakenos_0.3.0_amd64.tar'],
    ['con barra', 'sub/krakenos.deb'],
    ['con dos puntos seguidos', 'krakenos..deb'],
    ['demasiado largo', `${'a'.repeat(200)}.deb`],
  ])('rechaza el nombre %s', (_n, name) => {
    expect(() => parseManifest(conNombre(name))).toThrow(/manifiesto/i);
  });
  it('acepta .deb y .pkg.tar.zst', () => {
    expect(() => parseManifest(conNombre('krakenos_0.3.0_amd64.deb'))).not.toThrow();
    expect(() => parseManifest(conNombre('krakenos-0.3.0-1-x86_64.pkg.tar.zst'))).not.toThrow();
  });

  it('rechaza una clave RSA o EC (solo ed25519)', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const sig = sigOf(bytes);
    expect(verifyManifest(bytes, sig, pem(rsa.publicKey))).toBe(false);
    expect(verifyManifest(bytes, sig, pem(ec.publicKey))).toBe(false);
  });

  it('rechaza un size no entero', () => {
    const m = { ...manifest, artifacts: [{ ...manifest.artifacts[0], size: 1.5 }] };
    expect(() => parseManifest(Buffer.from(JSON.stringify(m)))).toThrow(/manifiesto/i);
  });

  it('una instalada con sufijo de prerelease se compara por su número (0.3.0-rc1 = 0.3.0)', () => {
    // isNewer usa parseInt: '0-rc1' → 0, así que 0.3.0-rc1 cuenta como 0.3.0 y NO es upgrade.
    expect(() => checkUpgrade(manifest, '0.3.0-rc1')).toThrow(
      expect.objectContaining({ code: 'NOT_AN_UPGRADE' }),
    );
    expect(() => checkUpgrade(manifest, '0.2.5-rc1')).not.toThrow();
  });
});

describe('plataforma win-x64', () => {
  const con = (name: string) =>
    Buffer.from(
      JSON.stringify({
        ...manifest,
        artifacts: [{ platform: 'win-x64', name, sha256: 'c'.repeat(64), size: 5 }],
      }),
    );
  it('acepta un artefacto win-x64 con nombre .exe', () => {
    const m = parseManifest(con('KrakenOS-Setup-0.3.0-x64.exe'));
    expect(artifactFor(m, 'win-x64').name).toBe('KrakenOS-Setup-0.3.0-x64.exe');
  });
  it.each(['../KrakenOS-Setup-0.3.0-x64.exe', 'KrakenOS-Setup-0.3.0-x64.msi'])(
    'sigue rechazando %s',
    (n) => {
      expect(() => parseManifest(con(n))).toThrow(/nombre de artefacto no válido/);
    },
  );
});
