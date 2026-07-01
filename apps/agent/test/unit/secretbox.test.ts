import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SecretDecryptError,
  createSecretbox,
  decryptSecret,
  encryptSecret,
  generateSecretboxKey,
  isEncrypted,
  loadOrCreateSecretbox,
  parseSecretboxKey,
} from '../../src/config/secretbox.js';

describe('secretbox — cifrado de secretos en reposo (US-139)', () => {
  const key = generateSecretboxKey();

  it('genera una clave de 32 bytes y aleatoria', () => {
    expect(key).toHaveLength(32);
    expect(generateSecretboxKey().equals(generateSecretboxKey())).toBe(false);
  });

  it('round-trip: descifrar lo cifrado devuelve el original (incl. unicode y vacío)', () => {
    for (const secret of ['hunter2', '', 'áéí-🔑-ñ', 'a'.repeat(5000)]) {
      expect(decryptSecret(encryptSecret(secret, key), key)).toBe(secret);
    }
  });

  it('cifra distinto cada vez (IV aleatorio) y nunca en claro', () => {
    const a = encryptSecret('mismo-valor', key);
    const b = encryptSecret('mismo-valor', key);
    expect(a).not.toBe(b); // IV distinto → ciphertext distinto
    expect(a).not.toContain('mismo-valor');
    expect(decryptSecret(a, key)).toBe('mismo-valor');
    expect(decryptSecret(b, key)).toBe('mismo-valor');
  });

  it('isEncrypted distingue un token cifrado del texto plano', () => {
    expect(isEncrypted(encryptSecret('x', key))).toBe(true);
    expect(isEncrypted('texto-plano')).toBe(false);
    expect(isEncrypted('kbx1.sólo.tres')).toBe(false);
  });

  it('una clave distinta no puede descifrar (SecretDecryptError)', () => {
    const token = encryptSecret('secreto', key);
    expect(() => decryptSecret(token, generateSecretboxKey())).toThrow(SecretDecryptError);
  });

  it('un ciphertext o tag manipulado falla la autenticación', () => {
    const token = encryptSecret('secreto', key);
    const parts = token.split('.');
    const flipLast = (b64: string): string => {
      const buf = Buffer.from(b64, 'base64');
      buf[buf.length - 1]! ^= 0xff;
      return buf.toString('base64');
    };
    const tamperedCt = [parts[0], parts[1], parts[2], flipLast(parts[3]!)].join('.');
    const tamperedTag = [parts[0], parts[1], flipLast(parts[2]!), parts[3]].join('.');
    expect(() => decryptSecret(tamperedCt, key)).toThrow(SecretDecryptError);
    expect(() => decryptSecret(tamperedTag, key)).toThrow(SecretDecryptError);
  });

  it('rechaza formatos no reconocidos y longitudes inválidas', () => {
    expect(() => decryptSecret('no-es-un-token', key)).toThrow(SecretDecryptError);
    expect(() => decryptSecret('kbx9.a.b.c', key)).toThrow(SecretDecryptError);
    // Nonce demasiado corto (1 byte en base64).
    expect(() => decryptSecret(`kbx1.${Buffer.from([1]).toString('base64')}.${'A'.repeat(24)}.AA`, key)).toThrow(
      SecretDecryptError,
    );
  });

  it('encrypt/decrypt con clave de longitud inválida lanza', () => {
    const bad = Buffer.alloc(16);
    expect(() => encryptSecret('x', bad)).toThrow();
    expect(() => decryptSecret(encryptSecret('x', key), bad)).toThrow(SecretDecryptError);
  });

  describe('parseSecretboxKey', () => {
    it('acepta 32 bytes en base64 y 64 dígitos hex', () => {
      const raw = generateSecretboxKey();
      expect(parseSecretboxKey(raw.toString('base64')).equals(raw)).toBe(true);
      expect(parseSecretboxKey(raw.toString('hex')).equals(raw)).toBe(true);
      expect(parseSecretboxKey(`  ${raw.toString('base64')}\n`).equals(raw)).toBe(true);
    });

    it('rechaza claves de longitud incorrecta', () => {
      expect(() => parseSecretboxKey(Buffer.alloc(16).toString('base64'))).toThrow();
      expect(() => parseSecretboxKey('abc')).toThrow();
    });
  });

  describe('loadOrCreateSecretbox', () => {
    let dir: string;
    beforeAll(() => {
      dir = mkdtempSync(join(tmpdir(), 'kraken-secretbox-'));
    });
    afterAll(() => rmSync(dir, { recursive: true, force: true }));

    it('crea la clave si no existe (chmod 600) y luego la reutiliza', () => {
      const path = join(dir, 'nested', 'secretbox.key');
      const box1 = loadOrCreateSecretbox(path);
      const token = box1.encrypt('persistente');

      // El fichero se creó con permisos restrictivos.
      const mode = statSync(path).mode & 0o777;
      expect(mode & 0o077).toBe(0); // ni grupo ni otros

      // Una segunda carga usa la MISMA clave del disco → descifra el token anterior.
      const box2 = loadOrCreateSecretbox(path);
      expect(box2.decrypt(token)).toBe('persistente');
    });

    it('carga una clave existente escrita a mano', () => {
      const path = join(dir, 'manual.key');
      const raw = generateSecretboxKey();
      writeFileSync(path, raw.toString('base64'));
      const box = loadOrCreateSecretbox(path);
      const token = box.encrypt('hola');
      expect(decryptSecret(token, raw)).toBe('hola');
      // El fichero no se sobrescribió.
      expect(readFileSync(path, 'utf8')).toBe(raw.toString('base64'));
    });
  });
});
