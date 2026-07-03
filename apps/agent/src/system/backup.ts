import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';

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

export interface ArchiveEntry {
  /** Ruta relativa dentro del backup, p. ej. `db/app.db`, `keys/secretbox.key`. */
  name: string;
  data: Buffer;
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
    const end = offset + m.length;
    if (end > buf.length) throw new Error('Backup dañado (payload truncado)');
    entries.push({ name: m.name, data: buf.subarray(offset, end) });
    offset = end;
  }
  return entries;
}

/** Cifra `plain` con una clave derivada de `passphrase`: `[KBK1][salt][iv][tag][ct]`. */
export function encryptArchive(plain: Buffer, passphrase: string): Buffer {
  if (passphrase.length < 8) {
    throw new Error('La contraseña del backup debe tener al menos 8 caracteres');
  }
  const salt = randomBytes(SALT_LEN);
  const key = scryptSync(passphrase, salt, 32);
  const iv = randomBytes(IV_LEN);
  // authTagLength explícito: requerido por el SAST (semgrep gcm-no-tag-length) y
  // fija el tag GCM a 128 bits (igual que en `config/secretbox.ts`).
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([ENC_MAGIC, salt, iv, tag, ct]);
}

/** Descifra un blob de `encryptArchive`. Lanza si la passphrase es incorrecta o está dañado. */
export function decryptArchive(blob: Buffer, passphrase: string): Buffer {
  const min = ENC_MAGIC.length + SALT_LEN + IV_LEN + TAG_LEN;
  if (blob.length < min || !blob.subarray(0, ENC_MAGIC.length).equals(ENC_MAGIC)) {
    throw new Error('Archivo de backup no reconocido');
  }
  let p = ENC_MAGIC.length;
  const salt = blob.subarray(p, (p += SALT_LEN));
  const iv = blob.subarray(p, (p += IV_LEN));
  const tag = blob.subarray(p, (p += TAG_LEN));
  const ct = blob.subarray(p);
  const key = scryptSync(passphrase, salt, 32);
  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new Error('Contraseña incorrecta o backup dañado');
  }
}
