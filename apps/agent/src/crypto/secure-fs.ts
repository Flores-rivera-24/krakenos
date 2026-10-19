import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fchmodSync,
  fchownSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

/**
 * Escritura de ficheros con material criptográfico (claves JWT, CA local, certificado
 * del servidor). Sustituye las garantías que daban `umask 077`, `mv` y `[[ -L ]]` en
 * los scripts de bash (US-277), y las refuerza donde bash no llegaba:
 *
 *   · Un fichero con una clave NACE con el modo final (`flag: 'wx'` + `mode`), sin la
 *     ventana entre crearlo legible y hacerle `chmod`. `wx` además falla si el destino
 *     temporal existe o es un enlace simbólico (O_EXCL no sigue enlaces).
 *   · Se publica con `rename` desde un temporal del MISMO directorio: atómico, y un
 *     `rename` sobre un enlace simbólico reemplaza el enlace, no escribe a través de él.
 *   · Cambiar modo o grupo de un fichero ya publicado se hace por descriptor abierto con
 *     O_NOFOLLOW (`fchmod`/`fchown`), no por ruta: `chmod`/`chgrp` por ruta siguen
 *     enlaces, y el timer de renovación corre como root.
 */

/** Un destino que no se debe tocar (p. ej. un enlace simbólico donde irían claves). */
export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafePathError';
  }
}

/** ¿Existe `path` (sin seguir enlaces)? Solo ENOENT cuenta como «no existe». */
export function existsNoFollow(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw err;
  }
}

/** Falla si `path` existe y es un enlace simbólico. */
export function assertNotSymlink(path: string): void {
  let isLink = false;
  try {
    isLink = lstatSync(path).isSymbolicLink();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
  if (isLink) {
    throw new UnsafePathError(`${path} es un enlace simbólico: me niego a escribir a través de él`);
  }
}

/**
 * Escribe `data` en un temporal oculto junto a `path` y devuelve su ruta. El temporal
 * nace con `mode` (no con el permisivo por defecto): una clave nunca existe legible.
 */
export function writeTempFile(path: string, data: string | Buffer, mode: number): string {
  const tmp = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`);
  try {
    writeFileSync(tmp, data, { flag: 'wx', mode });
    // `mode` queda recortado por el umask del proceso: se fija el final explícitamente.
    // El temporal es nuestro (O_EXCL), así que `chmod` por ruta no puede seguir un enlace.
    chmodSync(tmp, mode);
  } catch (err) {
    removeQuietly(tmp);
    throw err;
  }
  return tmp;
}

/** Publica un temporal sobre su destino (atómico). Si falla, borra el temporal. */
export function commitTempFile(
  tmp: string,
  path: string,
  rename: (from: string, to: string) => void = renameSync,
): void {
  try {
    rename(tmp, path);
  } catch (err) {
    removeQuietly(tmp);
    throw err;
  }
}

/** Escribe `data` en `path` de forma atómica y con `mode` desde el primer byte. */
export function writeFileAtomic(path: string, data: string | Buffer, mode: number): void {
  commitTempFile(writeTempFile(path, data, mode), path);
}

/** Borra un fichero ignorando que no esté. */
export function removeQuietly(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* ya no estaba, o no se puede: no es el error que importa */
  }
}

/** `fs.constants.O_NOFOLLOW`, que no existe en Windows (allí no hay enlaces que seguir así). */
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;

/**
 * Fija modo (y grupo, si se da) de un fichero YA publicado, por descriptor y sin seguir
 * enlaces simbólicos. El usuario no se toca (`-1`).
 */
export function applyModeAndGroup(path: string, mode: number, gid?: number): void {
  const fd = openSync(path, constants.O_RDONLY | NOFOLLOW);
  try {
    if (gid !== undefined) fchownSync(fd, -1, gid);
    fchmodSync(fd, mode);
  } finally {
    closeSync(fd);
  }
}

/** Resuelve un grupo (nombre o id numérico) a su gid. Node no trae `getgrnam`. */
export function resolveGroupId(group: string): number {
  if (/^\d+$/.test(group)) return Number(group);
  try {
    for (const line of readFileSync('/etc/group', 'utf8').split('\n')) {
      const [name, , gid] = line.split(':');
      if (name === group && gid && /^\d+$/.test(gid)) return Number(gid);
    }
  } catch {
    /* sin /etc/group legible: se prueba con NSS */
  }
  try {
    const out = execFileSync('getent', ['group', group], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const gid = out.split(':')[2];
    if (gid && /^\d+$/.test(gid.trim())) return Number(gid.trim());
  } catch {
    /* getent no está o no conoce el grupo */
  }
  throw new Error(`el grupo «${group}» no existe`);
}
