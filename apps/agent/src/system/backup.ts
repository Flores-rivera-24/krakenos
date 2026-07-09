import { createCipheriv, createDecipheriv, randomBytes, scrypt, scryptSync } from 'node:crypto';
import { yieldToEventLoop } from '../coverage/chunk.js';

/**
 * Formato de copia de seguridad de KrakenOS (US-103) — reemplaza el falso "backup"
 * (que solo exportaba 8 ajustes) por un archivo real que cubre las joyas de la
 * corona: la base SQLite, `keys/` (incluida `secretbox.key`, sin la cual los
 * secretos de integración cifrados en la DB serían irrecuperables) y `data/`.
 *
 * Sin dependencias nuevas (lockfile congelado en CI): un empaquetado propio
 * (manifest JSON + payloads concatenados) cifrado con AES-256-GCM y clave derivada
 * de una passphrase con scrypt. El archivo contiene secretos, por eso el cifrado es
 * obligatorio y la passphrase nunca se persiste.
 *
 * Todo aquí es **puro y testeable** (ida y vuelta, passphrase incorrecta lanza);
 * la E/S de ficheros y las rutas viven en `backup.service.ts`.
 */

const MAGIC = 'KRAKENOS-BACKUP';
const VERSION = 1;

const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
/** Prefijo de un blob cifrado: identifica el formato antes de intentar descifrar. */
const ENC_MAGIC = Buffer.from('KBK1', 'ascii');

// Parámetros scrypt. `KDF_LOG_N` (por defecto 16 → N=65536) se escribe en el envelope
// tras el magic, así el coste puede subir en el futuro sin romper archivos antiguos.
// Al descifrar se ACOTA el `logN` leído para que un archivo manipulado no fuerce una
// asignación de memoria enorme (DoS) — la derivación ocurre antes de autenticar.
const KDF_LOG_N = 16;
const KDF_R = 8;
const KDF_P = 1;
const KDF_MIN_LOG_N = 14;
const KDF_MAX_LOG_N = 17;
// maxmem cubre 2^KDF_MAX_LOG_N (≈128 MB para N=2^17, r=8).
const KDF_MAXMEM = 256 * 1024 * 1024;
/** Longitud mínima de la passphrase (el archivo cifra secretos → resistir fuerza bruta). */
const MIN_PASSPHRASE = 12;

function assertKdfParams(logN: number): void {
  if (!Number.isInteger(logN) || logN < KDF_MIN_LOG_N || logN > KDF_MAX_LOG_N) {
    throw new Error('Parámetros de cifrado del backup no válidos');
  }
}

function deriveKey(passphrase: string, salt: Buffer, logN: number): Buffer {
  assertKdfParams(logN);
  return scryptSync(passphrase, salt, 32, { N: 2 ** logN, r: KDF_R, p: KDF_P, maxmem: KDF_MAXMEM });
}

/** Como `deriveKey` pero en el threadpool de libuv (no bloquea el event loop, US-202). */
function deriveKeyAsync(passphrase: string, salt: Buffer, logN: number): Promise<Buffer> {
  assertKdfParams(logN);
  return new Promise((resolve, reject) => {
    scrypt(
      passphrase,
      salt,
      32,
      { N: 2 ** logN, r: KDF_R, p: KDF_P, maxmem: KDF_MAXMEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** Bytes cifrados/descifrados entre cesiones del event loop (patrón `coverage/chunk.ts`). */
const CIPHER_CHUNK = 4 * 1024 * 1024;

/** Pasa `data` por `update()` en trozos, cediendo el event loop entre trozo y trozo. */
async function cipherChunked(
  cipher: { update(data: Buffer): Buffer },
  data: Buffer,
): Promise<Buffer[]> {
  const parts: Buffer[] = [];
  for (let off = 0; off < data.length; off += CIPHER_CHUNK) {
    parts.push(cipher.update(data.subarray(off, off + CIPHER_CHUNK)));
    await yieldToEventLoop();
  }
  return parts;
}

export interface ArchiveEntry {
  /** Ruta relativa dentro del backup, p. ej. `db/app.db`, `keys/secretbox.key`. */
  name: string;
  data: Buffer;
}

/**
 * ¿Es un nombre de entrada seguro para escribir al restaurar? Solo un segmento
 * bajo `db/`, `keys/` o `data/` (sin `..`, sin rutas absolutas, sin subdirectorios
 * ni caracteres raros). Blinda la restauración contra *path traversal* / zip-slip:
 * un archivo manipulado no puede escribir fuera del árbol previsto.
 */
export function isSafeEntryName(name: string): boolean {
  // Un único segmento que EMPIEZA por alfanumérico (rechaza `.`, `..` y nombres con
  // punto inicial), bajo db/ keys/ data/. Sin `/` interior → sin traversal multinivel.
  return /^(db|keys|data)\/(?!\.\.?$)[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
}

interface ManifestEntry {
  name: string;
  length: number;
}

interface Manifest {
  magic: string;
  version: number;
  entries: ManifestEntry[];
}

/** Empaqueta entradas en un único buffer: `[u32 headerLen][header JSON][payloads…]`. */
export function packArchive(entries: ArchiveEntry[]): Buffer {
  const manifest: Manifest = {
    magic: MAGIC,
    version: VERSION,
    entries: entries.map((e) => ({ name: e.name, length: e.data.length })),
  };
  const header = Buffer.from(JSON.stringify(manifest), 'utf8');
  const headerLen = Buffer.alloc(4);
  headerLen.writeUInt32BE(header.length, 0);
  return Buffer.concat([headerLen, header, ...entries.map((e) => e.data)]);
}

/** Deshace `packArchive`. Lanza si el magic no coincide o el buffer está truncado. */
export function unpackArchive(buf: Buffer): ArchiveEntry[] {
  if (buf.length < 4) throw new Error('Backup dañado (cabecera incompleta)');
  const headerLen = buf.readUInt32BE(0);
  if (buf.length < 4 + headerLen) throw new Error('Backup dañado (cabecera truncada)');
  let manifest: Manifest;
  try {
    manifest = JSON.parse(buf.subarray(4, 4 + headerLen).toString('utf8')) as Manifest;
  } catch {
    throw new Error('Backup dañado (manifest ilegible)');
  }
  if (manifest.magic !== MAGIC) {
    throw new Error('Archivo de backup no reconocido');
  }
  let offset = 4 + headerLen;
  const entries: ArchiveEntry[] = [];
  for (const m of manifest.entries) {
    // No confíes en el manifest: nombre string y longitud entera no negativa.
    if (typeof m.name !== 'string' || !Number.isInteger(m.length) || m.length < 0) {
      throw new Error('Backup dañado (manifest inválido)');
    }
    const end = offset + m.length;
    if (end > buf.length) throw new Error('Backup dañado (payload truncado)');
    entries.push({ name: m.name, data: buf.subarray(offset, end) });
    offset = end;
  }
  return entries;
}

function assertPassphrase(passphrase: string): void {
  if (passphrase.length < MIN_PASSPHRASE) {
    throw new Error(`La contraseña del backup debe tener al menos ${MIN_PASSPHRASE} caracteres`);
  }
}

/** Cifra `plain` con clave derivada de `passphrase`: `[KBK1][logN][salt][iv][tag][ct]`. */
export function encryptArchive(plain: Buffer, passphrase: string): Buffer {
  assertPassphrase(passphrase);
  const salt = randomBytes(SALT_LEN);
  const key = deriveKey(passphrase, salt, KDF_LOG_N);
  const iv = randomBytes(IV_LEN);
  // authTagLength explícito: requerido por el SAST (semgrep gcm-no-tag-length) y
  // fija el tag GCM a 128 bits (igual que en `config/secretbox.ts`).
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ENC_MAGIC, Buffer.from([KDF_LOG_N]), salt, iv, tag, ct]);
}

/**
 * Como `encryptArchive` pero **cooperativo** (US-202 / AUD-06): scrypt en el
 * threadpool y AES por trozos cediendo el event loop. Mismo formato de envelope;
 * la paridad con la versión síncrona está verificada en tests.
 */
export async function encryptArchiveAsync(plain: Buffer, passphrase: string): Promise<Buffer> {
  assertPassphrase(passphrase);
  const salt = randomBytes(SALT_LEN);
  const key = await deriveKeyAsync(passphrase, salt, KDF_LOG_N);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  const parts = await cipherChunked(cipher, plain);
  const ct = Buffer.concat([...parts, cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ENC_MAGIC, Buffer.from([KDF_LOG_N]), salt, iv, tag, ct]);
}

interface Envelope {
  logN: number;
  salt: Buffer;
  iv: Buffer;
  tag: Buffer;
  ct: Buffer;
}

/** Valida y trocea el envelope `[KBK1][logN][salt][iv][tag][ct]`. */
function parseEnvelope(blob: Buffer): Envelope {
  const headerLen = ENC_MAGIC.length + 1 + SALT_LEN + IV_LEN + TAG_LEN;
  if (blob.length < headerLen || !blob.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) {
    throw new Error('Archivo de backup no reconocido');
  }
  let p = ENC_MAGIC.length;
  const logN = blob[p]!; // byte de coste scrypt (acotado en deriveKey)
  p += 1;
  const salt = blob.subarray(p, (p += SALT_LEN));
  const iv = blob.subarray(p, (p += IV_LEN));
  const tag = blob.subarray(p, (p += TAG_LEN));
  return { logN, salt, iv, tag, ct: blob.subarray(p) };
}

function makeDecipher(env: Envelope, key: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key, env.iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(env.tag);
  return decipher;
}

/** Descifra un blob de `encryptArchive`. Lanza si la passphrase es incorrecta o está dañado. */
export function decryptArchive(blob: Buffer, passphrase: string): Buffer {
  const env = parseEnvelope(blob);
  const decipher = makeDecipher(env, deriveKey(passphrase, env.salt, env.logN));
  try {
    return Buffer.concat([decipher.update(env.ct), decipher.final()]);
  } catch {
    throw new Error('Contraseña incorrecta o backup dañado');
  }
}

/** Como `decryptArchive` pero cooperativo (US-202 / AUD-06). */
export async function decryptArchiveAsync(blob: Buffer, passphrase: string): Promise<Buffer> {
  const env = parseEnvelope(blob);
  const decipher = makeDecipher(env, await deriveKeyAsync(passphrase, env.salt, env.logN));
  try {
    const parts = await cipherChunked(decipher, env.ct);
    return Buffer.concat([...parts, decipher.final()]);
  } catch {
    throw new Error('Contraseña incorrecta o backup dañado');
  }
}
