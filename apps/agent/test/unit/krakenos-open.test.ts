import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * `krakenos-open`: el lanzador de escritorio (SIN privilegios). Lee /etc/krakenos/origin, que es
 * del servicio de root pero no de confianza ciega: si no valida, no se abre ni se ejecuta nada.
 */

const WIN = process.platform === 'win32';
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const ABRIR = join(REPO, 'packaging', 'linux', 'common', 'krakenos-open');
const DEFECTO = 'http://localhost:3001';

let raiz: string;
beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'kraken-open-'));
  mkdirSync(join(raiz, 'etc', 'krakenos'), { recursive: true });
});
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

const origen = (c: string) => writeFileSync(join(raiz, 'etc', 'krakenos', 'origin'), c);
const correr = (args: string[] = ['--print'], path = '/usr/bin:/bin') =>
  spawnSync(ABRIR, ['--root', raiz, ...args], {
    encoding: 'utf8',
    timeout: 20000,
    env: { PATH: path },
  });

describe.skipIf(WIN)('krakenos-open', () => {
  it('con un origen válido imprime exactamente ese (las passkeys dependen del origen)', () => {
    origen('https://casa.tail1234.ts.net\n');
    const r = correr();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('https://casa.tail1234.ts.net');
  });

  it('sin archivo usa http://localhost:3001 y avisa por stderr', () => {
    const r = correr();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(DEFECTO);
    expect(r.stderr).toContain('AVISO');
  });

  it.each(['$(touch PWNED)', 'https://a.local;rm -rf x', 'https://a b', 'https://a\nhttps://b'])(
    'un origen con basura (%j) no valida, cae al por defecto y no ejecuta nada',
    (malo) => {
      origen(malo.replace('PWNED', join(raiz, 'pwned')) + '\n');
      const r = correr();
      expect(r.stdout.trim()).toBe(DEFECTO);
      expect(r.stderr).toContain('AVISO');
      expect(existsSync(join(raiz, 'pwned'))).toBe(false);
    },
  );

  it('sin xdg-open (y sin --print) sale ≠ 0 y el mensaje trae la URL para copiarla', () => {
    origen('https://casa.local:3001\n');
    const vacio = join(raiz, 'vacio');
    mkdirSync(vacio);
    // PATH sin xdg-open pero con lo básico: se enlaza solo lo que el script necesita.
    const r = spawnSync('/bin/bash', [ABRIR, '--root', raiz], {
      encoding: 'utf8',
      timeout: 20000,
      env: { PATH: vacio },
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('https://casa.local:3001');
  });

  it('con xdg-open lo llama con el origen', () => {
    origen('https://casa.local:3001\n');
    const bin = join(raiz, 'bin');
    mkdirSync(bin);
    const marca = join(raiz, 'llamada');
    writeFileSync(join(bin, 'xdg-open'), `#!/bin/sh\necho "$1" > "${marca}"\n`, { mode: 0o755 });
    const r = correr([], `${bin}:/usr/bin:/bin`);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(marca, 'utf8').trim()).toBe('https://casa.local:3001');
  });
});
