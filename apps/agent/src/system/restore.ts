import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { mkdir, open, rename, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import {
  ENVELOPE_HEADER_LEN,
  type ArchiveEntry,
  createArchiveDecryptor,
  decryptArchive,
  decryptArchiveAsync,
  isSafeEntryName,
  parseManifestHeader,
  unpackArchive,
} from './backup.js';

/**
 * Restauración de una copia de seguridad (US-104). Se hace en dos pasos por
 * seguridad: (1) `stageRestore` descifra, **valida** (anti path-traversal) y deja
 * los ficheros en un directorio de staging; (2) `applyStagedRestore` los coloca en
 * su sitio al **reiniciar** (no se puede intercambiar la DB SQLite viva de forma
 * segura), respaldando antes lo actual para que un fallo sea recuperable.
 */

export interface RestoreTargets {
  /** Ruta del fichero SQLite. */
  dbFile: string;
  /** Directorio de claves (`keys/`, incluida `secretbox.key`). */
  keysDir: string;
  /** Directorio de datos locales (`data/`). */
  dataDir: string;
}

/** Resuelve la ruta del fichero SQLite desde una `DATABASE_URL` (`file:…`). */
export function resolveDbFile(databaseUrl: string): string {
  const p = databaseUrl.replace(/^file:/, '');
  // Prisma resuelve las rutas sqlite relativas respecto al directorio del schema
  // (`prisma/`); en dev/prod el proceso corre desde `apps/agent`.
  return isAbsolute(p) ? p : resolve('prisma', p);
}

/**
 * Descifra y valida un backup, escribiendo sus ficheros en `stagingDir`. Lanza si
 * la passphrase es incorrecta, si falta la base de datos, o si algún nombre de
 * entrada no es seguro (path traversal). Devuelve los nombres escritos.
 */
export function stageRestore(blob: Buffer, passphrase: string, stagingDir: string): string[] {
  const entries = unpackArchive(decryptArchive(blob, passphrase));
  validateEntries(entries);
  rmSync(stagingDir, { recursive: true, force: true });
  for (const e of entries) {
    const dest = join(stagingDir, e.name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, e.data);
  }
  return entries.map((e) => e.name);
}

/**
 * Como `stageRestore` pero **cooperativo** (US-202 / AUD-06): descifrado por
 * trozos + E/S con `fs.promises`. Es la variante que usa la ruta HTTP; la
 * síncrona se conserva para tests y paridad.
 */
export async function stageRestoreAsync(
  blob: Buffer,
  passphrase: string,
  stagingDir: string,
): Promise<string[]> {
  const entries = unpackArchive(await decryptArchiveAsync(blob, passphrase));
  validateEntries(entries);
  await rm(stagingDir, { recursive: true, force: true });
  for (const e of entries) {
    const dest = join(stagingDir, e.name);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, e.data);
  }
  return entries.map((e) => e.name);
}

/** Validación compartida: nombres seguros (anti path-traversal) y DB presente. */
function validateEntries(entries: ArchiveEntry[]): void {
  validateEntryNames(entries.map((e) => e.name));
}

/** Igual, sobre solo los nombres (el lector por streaming valida antes de escribir). */
function validateEntryNames(names: string[]): void {
  for (const name of names) {
    if (!isSafeEntryName(name)) {
      throw new Error(`El backup contiene una ruta no válida: ${name}`);
    }
  }
  if (!names.includes('db/app.db')) {
    throw new Error('El backup no contiene la base de datos');
  }
}

/**
 * Escritor incremental del staging: recibe texto claro por trozos, saca el manifest
 * de los primeros bytes y va escribiendo cada entrada a disco sin acumularla en
 * memoria (US-233).
 *
 * Escribe a un directorio **temporal**: el texto claro que entrega GCM antes de
 * `final()` no está autenticado, así que nada puede aparecer en el staging
 * definitivo hasta que el archivo se verifique (`commit()`).
 */
class StagedArchiveWriter {
  private pending: Buffer = Buffer.alloc(0);
  private entries: { name: string; length: number }[] | null = null;
  private index = 0;
  private remaining = 0;
  private handle: FileHandle | null = null;

  constructor(private readonly tmpDir: string) {}

  /** Consume texto claro (no autenticado todavía). */
  async push(chunk: Buffer): Promise<void> {
    if (!this.entries) {
      this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
      const head = parseManifestHeader(this.pending);
      if (head.status === 'need-more') return;
      validateEntryNames(head.entries.map((e) => e.name));
      this.entries = head.entries;
      const rest = this.pending.subarray(head.consumed);
      this.pending = Buffer.alloc(0);
      this.remaining = this.entries[0]?.length ?? 0;
      await this.consume(rest);
      return;
    }
    await this.consume(chunk);
  }

  private async currentHandle(): Promise<FileHandle | null> {
    const entry = this.entries?.[this.index];
    if (!entry) return null;
    if (!this.handle) {
      const dest = join(this.tmpDir, entry.name);
      await mkdir(dirname(dest), { recursive: true });
      this.handle = await open(dest, 'w', 0o600);
    }
    return this.handle;
  }

  private async advance(): Promise<void> {
    if (this.handle) {
      await this.handle.close();
      this.handle = null;
    }
    this.index += 1;
    this.remaining = this.entries?.[this.index]?.length ?? 0;
  }

  private async consume(buf: Buffer): Promise<void> {
    let rest = buf;
    while (this.entries && this.index < this.entries.length) {
      // Crea el fichero aunque la entrada esté vacía (un `data/x.json` de 0 bytes
      // debe restaurarse como fichero vacío, no desaparecer).
      const fh = await this.currentHandle();
      if (!fh) return;
      if (this.remaining === 0) {
        await this.advance();
        continue;
      }
      if (rest.length === 0) return;
      const take = Math.min(this.remaining, rest.length);
      await fh.write(rest.subarray(0, take));
      this.remaining -= take;
      rest = rest.subarray(take);
      if (this.remaining === 0) await this.advance();
    }
    if (rest.length > 0) throw new Error('Backup dañado (bytes de más)');
  }

  /**
   * Cierra el último fichero y mueve el staging temporal al definitivo. Solo debe
   * llamarse **después** de que `final()` del descifrador haya autenticado.
   */
  async commit(stagingDir: string): Promise<string[]> {
    if (this.handle) {
      await this.handle.close();
      this.handle = null;
    }
    if (!this.entries) throw new Error('Backup dañado (cabecera incompleta)');
    if (this.index < this.entries.length || this.remaining > 0) {
      throw new Error('Backup dañado (payload truncado)');
    }
    await rm(stagingDir, { recursive: true, force: true });
    await mkdir(dirname(stagingDir), { recursive: true });
    await rename(this.tmpDir, stagingDir);
    return this.entries.map((e) => e.name);
  }

  /** Cierra sin publicar nada (fallo de autenticación, archivo dañado…). */
  async discard(): Promise<void> {
    if (this.handle) {
      await this.handle.close().catch(() => undefined);
      this.handle = null;
    }
    await rm(this.tmpDir, { recursive: true, force: true });
  }
}

/**
 * Prepara un restore leyendo el archivo **de disco por trozos** (US-233): la ruta de
 * subida ya no bufferiza el archivo en base64 (que además lo inflaba un 33 % y
 * topaba con el `bodyLimit` de 64 MB, así que se podía crear un backup **más grande
 * de lo que se podía restaurar** — AUD3-15).
 *
 * Orden de seguridad: se valida el manifest (anti path-traversal) antes de escribir
 * nada, se escribe a un staging **temporal**, y solo cuando GCM autentica el archivo
 * completo se publica en `stagingDir`.
 */
export async function stageRestoreFromFileAsync(
  archivePath: string,
  passphrase: string,
  stagingDir: string,
): Promise<string[]> {
  const source = await open(archivePath, 'r');
  const writer = new StagedArchiveWriter(`${stagingDir}.incoming`);
  try {
    await rm(`${stagingDir}.incoming`, { recursive: true, force: true });
    const header = Buffer.alloc(ENVELOPE_HEADER_LEN);
    const { bytesRead } = await source.read(header, 0, header.length, 0);
    if (bytesRead < header.length) throw new Error('Archivo de backup no reconocido');
    const decryptor = await createArchiveDecryptor(header, passphrase);

    const stream = source.createReadStream({ start: header.length, autoClose: false });
    for await (const chunk of stream) {
      await writer.push(decryptor.update(chunk as Buffer));
    }
    // Autentica ANTES de publicar: hasta aquí lo escrito es texto claro sin verificar.
    await writer.push(decryptor.final());
    return await writer.commit(stagingDir);
  } catch (err) {
    await writer.discard();
    throw err;
  } finally {
    await source.close();
  }
}

/** Lista los ficheros (relativos) bajo `dir` recorriendo `db/ keys/ data/`. */
function listStagedFiles(dir: string): string[] {
  const out: string[] = [];
  for (const prefix of ['db', 'keys', 'data']) {
    const sub = join(dir, prefix);
    if (!existsSync(sub)) continue;
    for (const name of readdirSync(sub)) {
      const full = join(sub, name);
      if (statSync(full).isFile()) out.push(`${prefix}/${name}`);
    }
  }
  return out;
}

/** Mapea un nombre de entrada a su destino real, o `null` si no aplica. */
function destFor(name: string, targets: RestoreTargets): string | null {
  if (name === 'db/app.db') return targets.dbFile;
  if (name.startsWith('keys/')) return join(targets.keysDir, name.slice('keys/'.length));
  if (name.startsWith('data/')) return join(targets.dataDir, name.slice('data/'.length));
  return null;
}

/**
 * Aplica un restore preparado: respalda cada fichero actual en `preRestoreDir` y
 * coloca el del staging en su sitio. Al terminar borra el staging. Devuelve los
 * nombres aplicados. Pensado para ejecutarse **al arrancar**, antes de abrir la DB.
 */
export function applyStagedRestore(
  stagingDir: string,
  targets: RestoreTargets,
  preRestoreDir: string,
): string[] {
  const applied: { rel: string; dest: string; existed: boolean }[] = [];
  try {
    for (const rel of listStagedFiles(stagingDir)) {
      if (!isSafeEntryName(rel)) continue; // defensa en profundidad
      const dest = destFor(rel, targets);
      if (!dest) continue;
      const existed = existsSync(dest);
      // Respalda lo actual (para poder revertir si un fichero posterior falla).
      if (existed) {
        const bak = join(preRestoreDir, rel);
        mkdirSync(dirname(bak), { recursive: true });
        copyFileSync(dest, bak);
      }
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(join(stagingDir, rel), dest);
      applied.push({ rel, dest, existed });
    }
  } catch (err) {
    // Aplicación ATÓMICA (best-effort): si un fichero falla a mitad, revierte los ya
    // aplicados —restaura el previo o borra el recién creado— y deja el staging para
    // que el arranque lo aparte. Así nunca queda un estado a medio restaurar.
    for (const { rel, dest, existed } of applied) {
      try {
        if (existed) copyFileSync(join(preRestoreDir, rel), dest);
        else rmSync(dest, { force: true });
      } catch {
        // mejor esfuerzo: la copia previa sigue en preRestoreDir para rescate manual
      }
    }
    throw err;
  }
  rmSync(stagingDir, { recursive: true, force: true });
  return applied.map((a) => a.rel);
}
