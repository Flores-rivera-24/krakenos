import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Cifrado simétrico de secretos en reposo (AES-256-GCM) — US-139.
 *
 * Las credenciales de integración (contraseñas SSH, API keys, `localKey` de Tuya,
 * tokens…) ahora pueden configurarse **desde la UI** y persistirse en la base de
 * datos en vez de en `.env`. Guardarlas en claro en SQLite empeoraría la postura
 * (modelo de amenazas, F8): un backup o export del `.db` filtraría todas las
 * credenciales de la red. Este módulo cifra cada secreto con una clave de 256 bits
 * que vive **solo en disco** (`keys/secretbox.key`, gitignored, `chmod 600`) — nunca
 * en la base ni en el repositorio. La base guarda únicamente el texto cifrado; sin la
 * clave del servidor no se puede descifrar.
 *
 * Formato del token: `kbx1.<iv>.<tag>.<ciphertext>` con las tres partes en base64.
 * El prefijo `kbx1` versiona el esquema para poder evolucionarlo sin romper los datos
 * ya cifrados. GCM aporta autenticación: cualquier manipulación del dato o de la clave
 * falla el `final()` en vez de devolver basura.
 */

const SCHEME = 'kbx1';
const KEY_BYTES = 32; // AES-256
const IV_BYTES = 12; // nonce estándar de GCM
const TAG_BYTES = 16; // tag de autenticación GCM

/** Error al descifrar: clave incorrecta, dato manipulado o formato no reconocido. */
export class SecretDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretDecryptError';
  }
}

/** Genera una clave AES-256 aleatoria (32 bytes). */
export function generateSecretboxKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/**
 * Interpreta el contenido de un fichero de clave: base64 (nuestro formato) o 64
 * caracteres hex. Lanza si no decodifica a exactamente 32 bytes — una clave más corta
 * debilitaría el cifrado en silencio.
 */
export function parseSecretboxKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const b64 = Buffer.from(trimmed, 'base64');
  if (b64.length === KEY_BYTES) return b64;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) return Buffer.from(trimmed, 'hex');
  throw new Error(
    `La clave de secretbox debe ser 32 bytes en base64 o 64 dígitos hex (decodificó a ${b64.length}).`,
  );
}

/** Cifra `plaintext` con `key` y devuelve el token `kbx1.<iv>.<tag>.<ct>`. */
export function encryptSecret(plaintext: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) {
    throw new Error(`Clave de secretbox inválida: se esperaban ${KEY_BYTES} bytes.`);
  }
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [SCHEME, iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join('.');
}

/** Descifra un token producido por {@link encryptSecret}. Lanza {@link SecretDecryptError}. */
export function decryptSecret(token: string, key: Buffer): string {
  if (key.length !== KEY_BYTES) throw new SecretDecryptError('Clave de secretbox inválida.');
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== SCHEME) {
    throw new SecretDecryptError('Formato de secreto cifrado no reconocido.');
  }
  const iv = Buffer.from(parts[1]!, 'base64');
  const tag = Buffer.from(parts[2]!, 'base64');
  const ct = Buffer.from(parts[3]!, 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretDecryptError('Nonce o tag de autenticación con longitud inválida.');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretDecryptError('No se pudo descifrar (clave incorrecta o dato manipulado).');
  }
}

/** ¿`value` tiene la forma de un secreto ya cifrado por este módulo? */
export function isEncrypted(value: string): boolean {
  return value.startsWith(`${SCHEME}.`) && value.split('.').length === 4;
}

/** Caja de secretos ligada a una clave concreta. */
export interface Secretbox {
  encrypt(plaintext: string): string;
  decrypt(token: string): string;
}

/** Crea una {@link Secretbox} a partir de una clave de 32 bytes. */
export function createSecretbox(key: Buffer): Secretbox {
  return {
    encrypt: (plaintext) => encryptSecret(plaintext, key),
    decrypt: (token) => decryptSecret(token, key),
  };
}

/**
 * Carga la clave desde `path`; si no existe, la **crea** (32 bytes aleatorios en
 * base64, `chmod 600`) y sus directorios. Igual que las claves RS256 (`gen-keys.sh`)
 * y VAPID (`ensureKeys`), la clave se materializa al arrancar si falta, de modo que el
 * cifrado "simplemente funciona" sin un paso manual. Devuelve un {@link Secretbox}.
 */
export function loadOrCreateSecretbox(path: string): Secretbox {
  let raw: string | null = null;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    raw = null;
  }
  if (raw && raw.trim()) {
    return createSecretbox(parseSecretboxKey(raw));
  }
  const key = generateSecretboxKey();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, key.toString('base64'), { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {
    /* best-effort: algunos sistemas de ficheros no aplican el modo */
  }
  return createSecretbox(key);
}
