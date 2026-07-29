import { createReadStream } from 'node:fs';
import { mkdir, mkdtemp, open, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { buildManifestHeader, createArchiveEncryptor } from './backup.js';

/**
 * Copia de seguridad real (US-103). Reemplaza el falso "backup" (que solo
 * exportaba 8 ajustes cosméticos y daba una falsa sensación de seguridad) por un
 * archivo cifrado que cubre lo que de verdad importa:
 *  - la base SQLite (snapshot consistente vía `VACUUM INTO`, sin bloquear la app),
 *  - `keys/` (incluida `secretbox.key`, sin la cual los secretos de integración
 *    cifrados en la DB serían irrecuperables tras restaurar),
 *  - `data/` (localKeys Tuya, rtspUrl de cámaras, peers WireGuard, reglas…).
 * El archivo contiene secretos → cifrado con passphrase obligatorio.
 *
 * Toda la E/S y el cifrado son **asíncronos/cooperativos** (US-202 / AUD-06):
 * en hardware modesto la versión síncrona congelaba Socket.io y los barridos
 * varios segundos (misma clase de problema que el heatmap).
 *
 * **Desde US-233 el archivo se escribe a un fichero temporal por streaming**, no a
 * un Buffer: antes se mantenían ~3 copias completas de la base en memoria (snapshot
 * + empaquetado + ciphertext) y el pico de RSS proyectado era de ~1,8 GB en una
 * máquina cuyo mínimo declarado son 900 MB (AUD3-15). Ahora el consumo es del orden
 * del trozo de cifrado, y la ruta sirve el fichero por stream.
 */

const DEFAULT_KEYS_DIR = resolve('keys');
const DEFAULT_DATA_DIR = resolve('data');

/** Bytes leídos de disco por vuelta (mismo orden que el trozo de cifrado). */
const READ_CHUNK = 4 * 1024 * 1024;

export interface BackupPaths {
  keysDir?: string;
  dataDir?: string;
}

/** Entrada del archivo cuyo contenido vive en **disco**, no en memoria. */
interface FileEntry {
  name: string;
  path: string;
  size: number;
}

export interface BackupFileResult {
  /** Ruta del archivo cifrado escrito. */
  path: string;
  /** Tamaño en bytes del archivo cifrado. */
  bytes: number;
}

/** Lista (no recursivo) los ficheros de `dir` como entradas `prefix/<nombre>`. */
async function listDirEntries(dir: string, prefix: string): Promise<FileEntry[]> {
  if (!existsSync(dir)) return [];
  const out: FileEntry[] = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    const st = await stat(full);
    if (st.isFile()) out.push({ name: `${prefix}/${name}`, path: full, size: st.size });
  }
  return out;
}

export class BackupService {
  private readonly keysDir: string;
  private readonly dataDir: string;

  constructor(
    private readonly prisma: PrismaClient,
    paths: BackupPaths = {},
  ) {
    this.keysDir = paths.keysDir ?? DEFAULT_KEYS_DIR;
    this.dataDir = paths.dataDir ?? DEFAULT_DATA_DIR;
  }

  /** Snapshot consistente de la base SQLite a un fichero temporal (no a memoria). */
  private async snapshotDbToFile(destDir: string): Promise<FileEntry> {
    const tmp = join(destDir, 'snapshot.db');
    // `VACUUM INTO` produce una copia consistente sin bloquear la base viva y, con
    // WAL (US-228), incluye lo que aún no se ha checkpointeado.
    // La ruta la construimos nosotros (no es entrada de usuario); escapamos comillas.
    await this.prisma.$executeRawUnsafe(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    return { name: 'db/app.db', path: tmp, size: (await stat(tmp)).size };
  }

  /**
   * Escribe el archivo cifrado a `destPath` pasando cada fichero por el cifrador en
   * trozos. Si un fichero cambia de tamaño mientras se lee, **falla en voz alta**:
   * el manifest ya declaró su longitud y un desajuste produciría un backup que
   * parece válido y se desalinea al restaurar.
   */
  private async writeArchive(
    entries: FileEntry[],
    passphrase: string,
    destPath: string,
  ): Promise<number> {
    const enc = await createArchiveEncryptor(passphrase);
    await mkdir(dirname(destPath), { recursive: true });
    const fh = await open(destPath, 'w', 0o600);
    let bytes = 0;
    try {
      const write = async (buf: Buffer): Promise<void> => {
        if (buf.length === 0) return;
        await fh.write(buf);
        bytes += buf.length;
      };

      await write(enc.header);
      await write(
        enc.update(buildManifestHeader(entries.map((e) => ({ name: e.name, length: e.size })))),
      );

      for (const entry of entries) {
        let read = 0;
        const stream = createReadStream(entry.path, { highWaterMark: READ_CHUNK });
        for await (const chunk of stream) {
          const buf = chunk as Buffer;
          read += buf.length;
          if (read > entry.size) {
            throw new Error(`«${entry.name}» creció durante la copia; inténtalo de nuevo`);
          }
          await write(enc.update(buf));
        }
        if (read !== entry.size) {
          throw new Error(`«${entry.name}» cambió durante la copia; inténtalo de nuevo`);
        }
      }

      const { rest, tag } = enc.final();
      await write(rest);
      // El tag GCM solo se conoce ahora y va ANTES del ciphertext: se parchea su hueco.
      await fh.write(tag, 0, tag.length, enc.tagOffset);
    } catch (err) {
      await fh.close();
      await rm(destPath, { force: true });
      throw err;
    }
    await fh.close();
    return bytes;
  }

  /**
   * Construye el archivo de copia de seguridad **cifrado** (DB + keys + data) en
   * `destPath`. Devuelve la ruta y el tamaño; el llamante decide si lo sirve por
   * stream (descarga) o lo conserva (copia automática).
   */
  async createToFile(passphrase: string, destPath: string): Promise<BackupFileResult> {
    const tmpDir = await mkdtemp(join(tmpdir(), 'krakenos-bak-'));
    try {
      const entries: FileEntry[] = [
        await this.snapshotDbToFile(tmpDir),
        ...(await listDirEntries(this.keysDir, 'keys')),
        ...(await listDirEntries(this.dataDir, 'data')),
      ];
      const bytes = await this.writeArchive(entries, passphrase, destPath);
      return { path: destPath, bytes };
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  }

  /**
   * Nombre de archivo para una copia: `krakenos-backup-<ISO compacto>.kbk`. Ordena
   * alfabéticamente igual que cronológicamente, así la retención por nombre es fiable.
   */
  static fileNameFor(date: Date): string {
    const iso = date.toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
    return `krakenos-backup-${iso}Z.kbk`;
  }

  /** ¿Es un nombre de copia generado por nosotros? (para no podar ficheros ajenos). */
  static isBackupFileName(name: string): boolean {
    return /^krakenos-backup-[0-9TZ.-]+\.kbk$/.test(basename(name));
  }
}
