import { generateKeyPairSync } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Keyring } from '../../src/auth/keyring.js';
import { authPlugin } from '../../src/plugins/auth.js';

function keypair(): { privateKey: string; publicKey: string } {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

/** Lee la cabecera (sin verificar) de un JWT. */
function decodeHeader(token: string): { alg?: string; kid?: string } {
  const segment = token.split('.')[0] ?? '';
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as {
    alg?: string;
    kid?: string;
  };
}

const ACCESS = { sub: 'u1', email: 'a@krakenos.test', role: 'admin' as const, type: 'access' as const };

async function appWithKeyring(keyring: Keyring): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(authPlugin, { keyring });
  await app.ready();
  return app;
}

describe('rotación de claves RS256 (US-64)', () => {
  const keyA = keypair();
  const keyB = keypair();
  const keyC = keypair();

  const ringA = new Keyring({ privateKey: keyA.privateKey, publicKey: keyA.publicKey }, [keyB.publicKey]);
  const ringB = new Keyring({ privateKey: keyB.privateKey, publicKey: keyB.publicKey });
  const ringC = new Keyring({ privateKey: keyC.privateKey, publicKey: keyC.publicKey });

  // appA: clave actual A + clave previa B (solape). appB/appC: solo su clave actual.
  let appA: FastifyInstance;
  let appB: FastifyInstance;
  let appC: FastifyInstance;

  beforeAll(async () => {
    appA = await appWithKeyring(ringA);
    appB = await appWithKeyring(ringB);
    appC = await appWithKeyring(ringC);
  });

  afterAll(async () => {
    await Promise.all([appA.close(), appB.close(), appC.close()]);
  });

  it('los tokens emitidos llevan el kid de la clave de firma en la cabecera', () => {
    const token = appA.jwt.sign(ACCESS);
    const header = decodeHeader(token);
    expect(header.alg).toBe('RS256');
    expect(header.kid).toBe(ringA.signingKid);
  });

  it('verifica los tokens firmados con la clave actual', () => {
    const token = appA.jwt.sign(ACCESS);
    const claims = appA.verifyToken(token);
    expect(claims.sub).toBe('u1');
    expect(claims.type).toBe('access');
  });

  it('acepta un token firmado con la clave PREVIA durante el solape', () => {
    // Token firmado por B (kid = kidB). appA tiene B como clave previa.
    const tokenSignedByB = appB.jwt.sign(ACCESS);
    expect(decodeHeader(tokenSignedByB).kid).toBe(ringB.signingKid);

    const claims = appA.verifyToken(tokenSignedByB);
    expect(claims.sub).toBe('u1');
  });

  it('rechaza un token firmado con una clave que no está en el llavero', () => {
    const tokenSignedByC = appC.jwt.sign(ACCESS);
    expect(() => appA.verifyToken(tokenSignedByC)).toThrow();
  });

  it('tras retirar la clave previa, el token anterior deja de verificar (fin del solape)', async () => {
    const tokenSignedByB = appB.jwt.sign(ACCESS);
    // Mismo "actual" A pero sin la previa B: simula el despliegue posterior al solape.
    const ringAfter = new Keyring({ privateKey: keyA.privateKey, publicKey: keyA.publicKey });
    const appAfter = await appWithKeyring(ringAfter);
    try {
      expect(() => appAfter.verifyToken(tokenSignedByB)).toThrow();
    } finally {
      await appAfter.close();
    }
  });
});
