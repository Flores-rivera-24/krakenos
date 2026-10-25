import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetAgentPathsForTests } from '../../src/config/paths.js';

/**
 * `KRAKENOS_DATA_DIR` mueve TODO el estado, también las claves JWT y los certificados: las
 * rutas relativas del `.env` (`./keys/…`, `./certs/…`) cuelgan de él, no del `cwd` (US-280).
 * Sin la variable, la raíz es el `cwd` y nada cambia (Linux, Docker).
 */
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  resetAgentPathsForTests();
});

async function cargarEnv() {
  vi.resetModules();
  resetAgentPathsForTests();
  return (await import('../../src/config/env.js')).env;
}

describe('rutas relativas del .env y KRAKENOS_DATA_DIR', () => {
  it('con KRAKENOS_DATA_DIR: claves JWT, secretbox y certificados salen del mismo árbol', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'krakenos-datadir-'));
    mkdirSync(join(raiz, 'keys'));
    writeFileSync(join(raiz, 'keys', 'jwt-private.pem'), 'priv-no-es-un-secreto');
    writeFileSync(join(raiz, 'keys', 'jwt-public.pem'), 'pub-no-es-un-secreto');
    vi.stubEnv('KRAKENOS_DATA_DIR', raiz);
    vi.stubEnv('JWT_PRIVATE_KEY_PATH', './keys/jwt-private.pem');
    vi.stubEnv('JWT_PUBLIC_KEY_PATH', './keys/jwt-public.pem');
    vi.stubEnv('SECRETBOX_KEY_PATH', undefined);
    vi.stubEnv('TLS_CA_CERT_PATH', undefined);

    const env = await cargarEnv();

    expect(env.jwtPrivateKeyPath).toBe(join(raiz, 'keys', 'jwt-private.pem'));
    expect(env.jwtPublicKeyPath).toBe(join(raiz, 'keys', 'jwt-public.pem'));
    expect(env.jwtPrivateKey).toBe('priv-no-es-un-secreto');
    expect(env.secretboxKeyPath).toBe(join(raiz, 'keys', 'secretbox.key'));
    expect(env.tlsCaCertPath).toBe(join(raiz, 'certs', 'krakenos-ca.pem'));
  });

  it('una ruta ABSOLUTA no cuelga de KRAKENOS_DATA_DIR', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'krakenos-datadir-'));
    const otra = mkdtempSync(join(tmpdir(), 'krakenos-otra-'));
    writeFileSync(join(otra, 'priv.pem'), 'a-no-es-un-secreto');
    writeFileSync(join(otra, 'pub.pem'), 'b-no-es-un-secreto');
    vi.stubEnv('KRAKENOS_DATA_DIR', raiz);
    vi.stubEnv('JWT_PRIVATE_KEY_PATH', join(otra, 'priv.pem'));
    vi.stubEnv('JWT_PUBLIC_KEY_PATH', join(otra, 'pub.pem'));

    const env = await cargarEnv();
    expect(env.jwtPrivateKeyPath).toBe(join(otra, 'priv.pem'));
  });

  it('sin KRAKENOS_DATA_DIR las relativas se resuelven contra el cwd, como siempre', async () => {
    vi.stubEnv('KRAKENOS_DATA_DIR', '');
    const env = await cargarEnv();
    expect(env.jwtPrivateKeyPath).toBe(resolve('./keys/jwt-private.pem'));
    expect(env.jwtPublicKeyPath).toBe(resolve('./keys/jwt-public.pem'));
    expect(env.secretboxKeyPath).toBe(resolve('keys', 'secretbox.key'));
  });
});
