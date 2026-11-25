import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  runVerifyCli,
  verifyUpdate,
  type VerifyUpdateOptions,
} from '../../src/system/verify-update.js';

const pem = (k: ReturnType<typeof generateKeyPairSync>['publicKey']) =>
  k.export({ type: 'spki', format: 'pem' }).toString();
const PKG = Buffer.from('contenido del paquete');
const NAME = 'krakenos_0.3.0_amd64.deb';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'verupd-'));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function fixture(
  over: { sigKey?: ReturnType<typeof generateKeyPairSync>; pkg?: Buffer } = {},
) {
  const good = generateKeyPairSync('ed25519');
  const signer = over.sigKey ?? good;
  const manifest = Buffer.from(
    JSON.stringify({
      schema: 1,
      version: '0.3.0',
      minFrom: '0.2.0',
      artifacts: [
        {
          platform: 'deb-amd64',
          name: NAME,
          sha256: createHash('sha256').update(PKG).digest('hex'),
          size: PKG.length,
        },
      ],
    }),
  );
  await writeFile(join(dir, 'manifest.json'), manifest);
  await writeFile(
    join(dir, 'manifest.json.sig'),
    sign(null, manifest, signer.privateKey).toString('base64'),
  );
  await writeFile(join(dir, NAME), over.pkg ?? PKG);
  const opts: VerifyUpdateOptions = {
    manifestFile: join(dir, 'manifest.json'),
    sigFile: join(dir, 'manifest.json.sig'),
    packageFile: join(dir, NAME),
    platform: 'deb-amd64',
    version: '0.3.0',
    installed: '0.2.0',
    publicKeyPem: pem(good.publicKey),
  };
  return opts;
}

describe('verifyUpdate (lo que ejecuta root sobre su copia)', () => {
  it('acepta firma, versión, nombre, tamaño y suma correctos', async () => {
    await expect(verifyUpdate(await fixture())).resolves.toBeUndefined();
  });
  it('rechaza una firma de otra clave', async () => {
    const o = await fixture({ sigKey: generateKeyPairSync('ed25519') });
    await expect(verifyUpdate(o)).rejects.toThrow(/firmado con la clave del proyecto/);
  });
  it('rechaza un paquete cambiado de contenido (misma longitud)', async () => {
    const o = await fixture({ pkg: Buffer.from('contenido del paquetX') });
    await expect(verifyUpdate(o)).rejects.toThrow(/suma/);
  });
  it('rechaza un paquete de otro tamaño', async () => {
    const o = await fixture({ pkg: Buffer.from('corto') });
    await expect(verifyUpdate(o)).rejects.toThrow(/tamaño/);
  });
  it('rechaza un downgrade y la misma versión', async () => {
    const o = await fixture();
    await expect(verifyUpdate({ ...o, installed: '0.3.0' })).rejects.toThrow(/no es más nueva/);
    await expect(verifyUpdate({ ...o, installed: '0.4.0' })).rejects.toThrow(/no es más nueva/);
  });
  it('rechaza instalar desde antes de minFrom', async () => {
    await expect(verifyUpdate({ ...(await fixture()), installed: '0.1.0' })).rejects.toThrow(
      /exige partir/,
    );
  });
  it('rechaza una versión distinta de la pedida', async () => {
    await expect(verifyUpdate({ ...(await fixture()), version: '0.3.1' })).rejects.toThrow(
      /no de la 0.3.1/,
    );
  });
  it('rechaza una plataforma sin artefacto y un nombre que no es el del manifiesto', async () => {
    const o = await fixture();
    await expect(verifyUpdate({ ...o, platform: 'arch-x86_64' })).rejects.toThrow(
      /no trae paquete/,
    );
    await writeFile(join(dir, 'otro.deb'), PKG);
    await expect(verifyUpdate({ ...o, packageFile: join(dir, 'otro.deb') })).rejects.toThrow(
      /nombre/,
    );
  });
  it('rechaza un enlace simbólico en lugar de un fichero', async () => {
    const o = await fixture();
    await rm(o.packageFile);
    await writeFile(join(dir, 'real'), PKG);
    await symlink(join(dir, 'real'), o.packageFile);
    await expect(verifyUpdate(o)).rejects.toThrow(/fichero normal/);
  });
  it('en un rollback (installed null) no exige que sea una versión más nueva', async () => {
    await expect(verifyUpdate({ ...(await fixture()), installed: null })).resolves.toBeUndefined();
  });
});

describe('verify-update con win-x64', () => {
  const EXE = 'KrakenOS-Setup-0.3.0-x64.exe';
  const BYTES = Buffer.from('instalador');
  async function conExe(bytes: Buffer) {
    const key = generateKeyPairSync('ed25519');
    const manifest = Buffer.from(
      JSON.stringify({
        schema: 1,
        version: '0.3.0',
        minFrom: '0.2.0',
        artifacts: [
          {
            platform: 'win-x64',
            name: EXE,
            sha256: createHash('sha256').update(BYTES).digest('hex'),
            size: BYTES.length,
          },
        ],
      }),
    );
    await writeFile(join(dir, 'manifest.json'), manifest);
    await writeFile(
      join(dir, 'manifest.json.sig'),
      sign(null, manifest, key.privateKey).toString('base64'),
    );
    await writeFile(join(dir, EXE), bytes);
    return (): Promise<number> =>
      runVerifyCli(
        [
          '--manifest',
          join(dir, 'manifest.json'),
          '--sig',
          join(dir, 'manifest.json.sig'),
          '--package',
          join(dir, EXE),
          '--platform',
          'win-x64',
          '--version',
          '0.3.0',
          '--installed',
          '0.2.0',
        ],
        pem(key.publicKey),
        () => undefined,
      );
  }
  it('verifica un .exe firmado (0) y rechaza uno con un byte cambiado (1)', async () => {
    expect(await (await conExe(BYTES))()).toBe(0);
    const malo = Buffer.from(BYTES);
    malo[0] = malo[0]! ^ 1;
    expect(await (await conExe(malo))()).toBe(1);
  });
});

describe('runVerifyCli', () => {
  const key = generateKeyPairSync('ed25519');
  const run = (argv: string[]) => {
    const errs: string[] = [];
    return runVerifyCli(argv, pem(key.publicKey), (l) => errs.push(l)).then((code) => ({
      code,
      errs,
    }));
  };
  it('uso incorrecto: 2 (argumento desconocido, falta un flag, plataforma rara, --rollback con --installed)', async () => {
    expect((await run(['--x', '1'])).code).toBe(2);
    expect((await run(['--manifest', 'a'])).code).toBe(2);
    const base = ['--manifest', 'a', '--sig', 'b', '--package', 'c', '--version', '0.3.0'];
    expect((await run([...base, '--platform', 'win', '--installed', '0.2.0'])).code).toBe(2);
    expect(
      (await run([...base, '--platform', 'deb-amd64', '--installed', '0.2.0', '--rollback'])).code,
    ).toBe(2);
  });
  it('un rechazo de verificación sale con 1 y un mensaje', async () => {
    const r = await run([
      '--manifest',
      '/no/existe',
      '--sig',
      'b',
      '--package',
      'c',
      '--version',
      '0.3.0',
      '--platform',
      'deb-amd64',
      '--installed',
      '0.2.0',
    ]);
    expect(r.code).toBe(1);
    expect(r.errs.length).toBe(1);
  });
});
