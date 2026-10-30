import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
// El @ts-expect-error solo cubre la linea siguiente: sin prettier-ignore Prettier parte el import
// en varias lineas y el error de tipos queda fuera de su alcance.
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { NODE_VERSION, resolveTarget } from '../../../../scripts/package/target.mjs';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { NODE_KEYRING, assertSha256, expectedSha256, verifySignature } from '../../../../scripts/package/node-runtime.mjs';

/**
 * US-284 — funciones puras del empaquetado (`pnpm package`): destino por plataforma y
 * verificación del Node que viaja dentro de la carpeta.
 */

describe('resolveTarget', () => {
  it('Windows x64: zip y node.exe', () => {
    expect(NODE_VERSION).toBe('24.21.0');
    expect(resolveTarget('win32', 'x64')).toEqual({
      id: 'win-x64',
      nodeArchive: 'node-v24.21.0-win-x64.zip',
      nodeBin: 'node/node.exe',
      launcher: 'krakenos.cmd',
    });
  });

  it('Linux x64 y arm64: tar.xz y bin/node', () => {
    expect(resolveTarget('linux', 'x64')).toMatchObject({
      id: 'linux-x64',
      nodeArchive: 'node-v24.21.0-linux-x64.tar.xz',
      nodeBin: 'node/bin/node',
      launcher: 'bin/krakenos',
    });
    expect(resolveTarget('linux', 'arm64').nodeArchive).toBe('node-v24.21.0-linux-arm64.tar.xz');
  });

  it('una plataforma sin soporte lanza nombrándola', () => {
    expect(() => resolveTarget('darwin', 'arm64')).toThrow(/darwin/);
    expect(() => resolveTarget('win32', 'arm64')).toThrow(/win32/);
  });
});

describe('expectedSha256', () => {
  const a = 'a'.repeat(64);
  const b = 'b'.repeat(64);
  const c = 'c'.repeat(64);
  const texto = `${a}  node-v1-linux-x64.tar.xz\n${b}  node-v1-win-x64.zip\n${c}  node-v1-linux-arm64.tar.xz\n`;

  it('devuelve la suma del fichero pedido', () => {
    expect(expectedSha256(texto, 'node-v1-win-x64.zip')).toBe(b);
  });

  it('lanza si el fichero no aparece', () => {
    expect(() => expectedSha256(texto, 'node-v1-aix-ppc64.tar.xz')).toThrow(/node-v1-aix-ppc64/);
  });

  it('lanza si el fichero aparece dos veces', () => {
    expect(() =>
      expectedSha256(`${texto}${c}  node-v1-win-x64.zip\n`, 'node-v1-win-x64.zip'),
    ).toThrow(/node-v1-win-x64\.zip/);
  });
});

describe('assertSha256', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('pasa con la suma real y lanza con otra nombrando las dos', async () => {
    dir = mkdtempSync(join(tmpdir(), 'pkg-sha-'));
    const f = join(dir, 'x.bin');
    writeFileSync(f, 'contenido');
    const real = createHash('sha256').update('contenido').digest('hex');
    await expect(assertSha256(f, real)).resolves.toBeUndefined();
    const otra = '0'.repeat(64);
    await expect(assertSha256(f, otra)).rejects.toThrow(
      new RegExp(`${otra}[\\s\\S]*${real}|${real}[\\s\\S]*${otra}`),
    );
  });
});

describe('verifySignature', () => {
  it('llama a gpg con los argumentos exactos y resuelve con code 0', async () => {
    const llamadas: Array<[string, string[]]> = [];
    await verifySignature({
      run: async (cmd: string, args: string[]) => {
        llamadas.push([cmd, args]);
        return { code: 0, stderr: '' };
      },
      keyring: '/k/pubring.kbx',
      signature: '/s/SHASUMS256.txt.sig',
      file: '/s/SHASUMS256.txt',
    });
    expect(llamadas).toEqual([
      [
        'gpg',
        [
          '--no-default-keyring',
          '--keyring',
          '/k/pubring.kbx',
          '--verify',
          '/s/SHASUMS256.txt.sig',
          '/s/SHASUMS256.txt',
        ],
      ],
    ]);
  });

  it('lanza con code distinto de 0', async () => {
    await expect(
      verifySignature({
        run: async () => ({ code: 1, stderr: 'BAD signature' }),
        keyring: 'k',
        signature: 's',
        file: 'f',
      }),
    ).rejects.toThrow(/BAD signature/);
  });
});

describe('NODE_KEYRING', () => {
  it('apunta a un commit fijado y trae una suma sha256', () => {
    expect(NODE_KEYRING.url).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/nodejs\/release-keys\/[0-9a-f]{40}\//,
    );
    expect(NODE_KEYRING.sha256).toMatch(/^[0-9a-f]{64}$/);
  });
});
