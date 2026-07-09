import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { type ArchiveEntry, encryptArchiveAsync, packArchive } from './backup.js';

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
 */

const DEFAULT_KEYS_DIR = resolve('keys');
const DEFAULT_DATA_DIR = resolve('data');

export interface BackupPaths {
  keysDir?: string;
  dataDir?: string;
}

/** Lee (no recursivo) los ficheros de `dir` como entradas con `prefix/`. Vacío si no existe. */
async function readDirEntries(dir: string, prefix: string): Promise<ArchiveEntry[]> {
  if (!existsSync(dir)) return [];
  const out: ArchiveEntry[] = [];
  for (const name of await readdir(dir)) {
    const full = join(dir, name);
    if ((await stat(full)).isFile()) {
      out.push({ name: `${prefix}/${name}`, data: await readFile(full) });
    }
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

  /** Snapshot consistente de la base SQLite a un fichero temporal, devuelto como Buffer. */
  private async snapshotDb(): Promise<Buffer> {
    const tmpDir = await mkdtemp(join(tmpdir(), 'krakenos-bak-'));
    const tmp = join(tmpDir, 'snapshot.db');
    try {
      // `VACUUM INTO` produce una copia consistente sin bloquear la base viva.
      // La ruta la construimos nosotros (no es entrada de usuario); escapamos comillas.
      await this.prisma.$executeRawUnsafe(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
      return await readFile(tmp);
    } finally {
      await rm(dirname(tmp), { recursive: true, force: true });
    }
  }

  /** Construye el archivo de copia de seguridad **cifrado** (DB + keys + data). */
  async create(passphrase: string): Promise<Buffer> {
    const entries: ArchiveEntry[] = [
      { name: 'db/app.db', data: await this.snapshotDb() },
      ...(await readDirEntries(this.keysDir, 'keys')),
      ...(await readDirEntries(this.dataDir, 'data')),
    ];
    return encryptArchiveAsync(packArchive(entries), passphrase);
  }
}
