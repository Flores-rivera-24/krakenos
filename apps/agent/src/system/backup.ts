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

export interface ManifestEntry {
  name: string;
  length: number;
}

interface Manifest {
  magic: string;
  version: number;
  entries: ManifestEntry[];
}

/** Resultado de leer la cabecera del plaintext (permite lectura incremental). */
export type ManifestHeaderResult =
  | { status: 'ok'; entries: ManifestEntry[]; consumed: number }
  | { status: 'need-more'; missing: 'length' | 'header' };

/**
 * Lee `[u32 headerLen][header JSON]` del principio del plaintext. Devuelve
 * `need-more` si aún no hay bytes suficientes — así el **lector por streaming**
 * (US-233) puede llamarla con lo que tenga hasta ahora. Lanza solo si lo que hay es
 * inválido de verdad (magic desconocido, JSON ilegible, entradas absurdas).
 */
export function parseManifestHeader(buf: Buffer): ManifestHeaderResult {
  if (buf.length < 4) return { status: 'need-more', missing: 'length' };
  const headerLen = buf.readUInt32BE(0);
  if (buf.length < 4 + headerLen) return { status: 'need-more', missing: 'header' };
  let manifest: Manifest;
  try {
    manifest = JSON.parse(buf.subarray(4, 4 + headerLen).toString('utf8')) as Manifest;
  } catch {
    throw new Error('Backup dañado (manifest ilegible)');
  }
  if (manifest.magic !== MAGIC) {
    throw new Error('Archivo de backup no reconocido');
  }
  if (!Array.isArray(manifest.entries)) {
    throw new Error('Backup dañado (manifest inválido)');
  }
  for (const m of manifest.entries) {
    // No confíes en el manifest: nombre string y longitud entera no negativa.
    if (typeof m.name !== 'string' || !Number.isInteger(m.length) || m.length < 0) {
      throw new Error('Backup dañado (manifest inválido)');
    }
  }
  return { status: 'ok', entries: manifest.entries, consumed: 4 + headerLen };
}

/**
 * Cabecera del plaintext: `[u32 headerLen][header JSON]`. Compartida por el
 * empaquetado en memoria y el **escritor por streaming** (US-233), para que los dos
 * produzcan exactamente el mismo formato.
 */
export function buildManifestHeader(entries: ManifestEntry[]): Buffer {
  const manifest: Manifest = { magic: MAGIC, version: VERSION, entries };
  const header = Buffer.from(JSON.stringify(manifest), 'utf8');
  const headerLen = Buffer.alloc(4);
  headerLen.writeUInt32BE(header.length, 0);
  return Buffer.concat([headerLen, header]);
}

/** Empaqueta entradas en un único buffer: `[u32 headerLen][header JSON][payloads…]`. */
export function packArchive(entries: ArchiveEntry[]): Buffer {
  const header = buildManifestHeader(entries.map((e) => ({ name: e.name, length: e.data.length })));
  return Buffer.concat([header, ...entries.map((e) => e.data)]);
}

/** Deshace `packArchive`. Lanza si el magic no coincide o el buffer está truncado. */
export function unpackArchive(buf: Buffer): ArchiveEntry[] {
  const head = parseManifestHeader(buf);
  if (head.status === 'need-more') {
    throw new Error(
      head.missing === 'length'
        ? 'Backup dañado (cabecera incompleta)'
        : 'Backup dañado (cabecera truncada)',
    );
  }
  let offset = head.consumed;
  const entries: ArchiveEntry[] = [];
  for (const m of head.entries) {
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

/**
 * Cifrador incremental para escribir el archivo **sin cargarlo entero en memoria**
 * (US-233 / AUD3-15): antes `create()` mantenía ~3 copias completas de la base en
 * RAM (snapshot + packArchive + ciphertext), con un pico de ~1,8 GB de RSS en la
 * escala proyectada — en una máquina cuyo mínimo declarado son 900 MB.
 *
 * El envelope es idéntico al de `encryptArchive` (`[KBK1][logN][salt][iv][tag][ct]`),
 * así que los archivos siguen siendo intercambiables. El detalle incómodo es que el
 * **tag GCM solo se conoce al terminar** y va *antes* del ciphertext: por eso
 * `header` reserva su hueco a ceros y quien escribe debe parchearlo en `tagOffset`
 * con una escritura posicional al final.
 */
export interface ArchiveEncryptor {
  /** Cabecera del envelope, con el hueco del tag a ceros. Se escribe primero. */
  header: Buffer;
  /** Desplazamiento del tag en el fichero, para parchearlo al final. */
  tagOffset: number;
  /** Cifra un trozo de plaintext. */
  update(chunk: Buffer): Buffer;
  /** Cierra el cifrado: último bloque + tag GCM que hay que parchear. */
  final(): { rest: Buffer; tag: Buffer };
}

/** Desplazamiento del tag GCM dentro del envelope. */
export const ENVELOPE_TAG_OFFSET = ENC_MAGIC.length + 1 + SALT_LEN + IV_LEN;

/** Crea el cifrador incremental (scrypt en el threadpool, como `encryptArchiveAsync`). */
export async function createArchiveEncryptor(passphrase: string): Promise<ArchiveEncryptor> {
  assertPassphrase(passphrase);
  const salt = randomBytes(SALT_LEN);
  const key = await deriveKeyAsync(passphrase, salt, KDF_LOG_N);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  return {
    header: Buffer.concat([
      ENC_MAGIC,
      Buffer.from([KDF_LOG_N]),
      salt,
      iv,
      Buffer.alloc(TAG_LEN), // hueco del tag, se parchea al final
    ]),
    tagOffset: ENVELOPE_TAG_OFFSET,
    update: (chunk) => cipher.update(chunk),
    final: () => ({ rest: cipher.final(), tag: cipher.getAuthTag() }),
  };
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

/** Longitud de la cabecera del envelope (todo lo que precede al ciphertext). */
export const ENVELOPE_HEADER_LEN = ENC_MAGIC.length + 1 + SALT_LEN + IV_LEN + TAG_LEN;

/**
 * Descifrador incremental para restaurar **sin cargar el archivo entero en
 * memoria** (US-233 / AUD3-15).
 *
 * ⚠️ **GCM solo autentica en `final()`**: todo lo que devuelve `update()` es texto
 * claro **no verificado**. Quien lo consuma NO debe colocarlo en su destino
 * definitivo hasta que `final()` haya pasado (`stageRestoreFromFileAsync` escribe a
 * un staging temporal y lo renombra después). Si se ignora eso, un archivo
 * manipulado escribe contenido elegido por el atacante.
 */
export interface ArchiveDecryptor {
  update(chunk: Buffer): Buffer;
  /** Cierra y **verifica** el tag GCM. Lanza si la passphrase o el archivo no cuadran. */
  final(): Buffer;
}

/** Crea el descifrador a partir de la cabecera del envelope (`ENVELOPE_HEADER_LEN` bytes). */
export async function createArchiveDecryptor(
  header: Buffer,
  passphrase: string,
): Promise<ArchiveDecryptor> {
  // `parseEnvelope` valida el magic y la longitud mínima; el `ct` sobra aquí.
  const env = parseEnvelope(header);
  const decipher = makeDecipher(env, await deriveKeyAsync(passphrase, env.salt, env.logN));
  return {
    update: (chunk) => decipher.update(chunk),
    final: () => {
      try {
        return decipher.final();
      } catch {
        throw new Error('Contraseña incorrecta o backup dañado');
      }
    },
  };
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
