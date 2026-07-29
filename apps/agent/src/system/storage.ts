import { statfs } from 'node:fs/promises';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { StorageInfo } from '@krakenos/types';

/**
 * Espacio en disco y tamaño de la base (US-233 / AUD3-21).
 *
 * Por qué existe: el fallo más probable de un aparato que vive 24/7 sobre una
 * tarjeta SD es quedarse sin espacio, y hasta ahora nada lo miraba — ni las métricas
 * ni el bundle de soporte. Un disco lleno hace que SQLite deje de escribir, que la
 * auditoría se pierda y que la copia de seguridad no se pueda crear, todo a la vez.
 *
 * Nota honesta sobre lo que se mide: con **WAL** (US-228) el tamaño real de la base
 * es el fichero principal **más** su `-wal`, que puede ser MB sin checkpointear. Se
 * suman los dos; si el `-wal` no existe, cuenta como 0.
 *
 * Las dependencias de sistema son inyectables para poder probar los casos que no se
 * pueden provocar aquí (disco lleno, FS que no responde).
 */

export interface StorageDeps {
  statfs?: (path: string) => Promise<{ bsize: number; blocks: number; bavail: number }>;
  stat?: (path: string) => Promise<{ size: number }>;
}

/**
 * Lee el estado del almacenamiento. **Nunca lanza**: lo que no se pueda medir sale
 * como `null` (un gauge ausente es información; una excepción tumbaría la ruta de
 * métricas o el bundle de soporte, que es justo lo que se consulta cuando algo va mal).
 */
export async function readStorageInfo(
  dbFile: string,
  deps: StorageDeps = {},
): Promise<StorageInfo> {
  const fsStatfs = deps.statfs ?? statfs;
  const fsStat = deps.stat ?? stat;

  let dbBytes: number | null = null;
  try {
    const main = await fsStat(dbFile);
    let total = main.size;
    // El WAL puede llevar megas sin checkpointear: forma parte de la base.
    try {
      total += (await fsStat(`${dbFile}-wal`)).size;
    } catch {
      // sin WAL (o modo delete): el fichero principal es todo
    }
    dbBytes = total;
  } catch {
    dbBytes = null;
  }

  let freeBytes: number | null = null;
  let totalBytes: number | null = null;
  try {
    const fs = await fsStatfs(dirname(dbFile));
    freeBytes = fs.bsize * fs.bavail;
    totalBytes = fs.bsize * fs.blocks;
  } catch {
    freeBytes = null;
    totalBytes = null;
  }

  return {
    dbBytes,
    diskFreeBytes: freeBytes,
    diskTotalBytes: totalBytes,
    diskUsedPercent:
      freeBytes !== null && totalBytes !== null && totalBytes > 0
        ? Math.round(((totalBytes - freeBytes) / totalBytes) * 100)
        : null,
  };
}
