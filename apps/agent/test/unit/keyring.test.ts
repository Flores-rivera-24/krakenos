import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Keyring, deriveKid } from '../../src/auth/keyring.js';

/** Genera un par RSA-2048 en formato PEM (igual que gen-keys.sh). */
function keypair(): { privateKey: string; publicKey: string } {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

describe('deriveKid', () => {
  const a = keypair();

  it('es estable: el mismo PEM produce el mismo kid', () => {
    expect(deriveKid(a.publicKey)).toBe(deriveKid(a.publicKey));
  });

  it('claves distintas producen kids distintos', () => {
    const b = keypair();
    expect(deriveKid(a.publicKey)).not.toBe(deriveKid(b.publicKey));
  });

  it('ignora diferencias de espaciado/saltos de línea', () => {
    const padded = `\n${a.publicKey}\n\n`;
    expect(deriveKid(padded)).toBe(deriveKid(a.publicKey));
  });
});

describe('Keyring', () => {
  const current = keypair();
  const prev = keypair();

  it('el signingKid deriva de la clave pública actual', () => {
    const ring = new Keyring(current);
    expect(ring.signingKid).toBe(deriveKid(current.publicKey));
    expect(ring.signingPrivateKey()).toBe(current.privateKey);
    expect(ring.signingPublicKey()).toBe(current.publicKey);
  });

  it('resuelve la clave pública por kid (actual y previa)', () => {
    const ring = new Keyring(current, [prev.publicKey]);
    expect(ring.publicKeyForKid(deriveKid(current.publicKey))).toBe(current.publicKey);
    expect(ring.publicKeyForKid(deriveKid(prev.publicKey))).toBe(prev.publicKey);
  });

  it('un kid ausente cae a la clave actual (tokens previos a la rotación)', () => {
    const ring = new Keyring(current, [prev.publicKey]);
    expect(ring.publicKeyForKid(undefined)).toBe(current.publicKey);
  });

  it('un kid desconocido devuelve undefined', () => {
    const ring = new Keyring(current, [prev.publicKey]);
    expect(ring.publicKeyForKid('0000000000000000')).toBeUndefined();
  });

  it('kids() incluye la actual y todas las previas', () => {
    const ring = new Keyring(current, [prev.publicKey]);
    expect(ring.kids().sort()).toEqual(
      [deriveKid(current.publicKey), deriveKid(prev.publicKey)].sort(),
    );
  });

  it('una previa que coincide con la actual no la duplica ni la pisa', () => {
    const ring = new Keyring(current, [current.publicKey]);
    expect(ring.kids()).toEqual([deriveKid(current.publicKey)]);
    expect(ring.publicKeyForKid(ring.signingKid)).toBe(current.publicKey);
  });
});
