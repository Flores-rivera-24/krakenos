import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { decryptArchive, isSafeEntryName, unpackArchive } from './backup.js';

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
  for (const e of entries) {
    if (!isSafeEntryName(e.name)) {
      throw new Error(`El backup contiene una ruta no válida: ${e.name}`);
    }
  }
  if (!entries.some((e) => e.name === 'db/app.db')) {
    throw new Error('El backup no contiene la base de datos');
  }
  rmSync(stagingDir, { recursive: true, force: true });
  for (const e of entries) {
    const dest = join(stagingDir, e.name);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, e.data);
  }
  return entries.map((e) => e.name);
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
