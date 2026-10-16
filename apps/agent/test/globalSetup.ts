import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateDatabase } from '../src/db/migrate.js';

/**
 * Prepara la base de datos de pruebas una sola vez antes de toda la suite:
 * borra cualquier `test.db` previa y aplica las migraciones versionadas con el
 * aplicador propio (US-275), el mismo código que corre en producción.
 * El cierre devuelto elimina el archivo al terminar.
 *
 * Prisma resuelve las rutas `file:` relativas al directorio del schema
 * (`prisma/`), así que `file:./test.db` vive en `prisma/test.db` — aislado
 * de `prisma/dev.db`.
 */
export default function setup(): () => void {
  const here = dirname(fileURLToPath(import.meta.url));
  const agentRoot = resolve(here, '..');
  const dbPath = resolve(agentRoot, 'prisma/test.db');

  if (existsSync(dbPath)) rmSync(dbPath);

  // La base es nueva, así que no habrá copia previa; el directorio es un temporal
  // por si acaso, para no dejar un `var/` en el árbol.
  const backupDir = mkdtempSync(join(tmpdir(), 'krakenos-test-premigrate-'));
  try {
    migrateDatabase({
      dbFile: dbPath,
      migrationsDir: resolve(agentRoot, 'prisma/migrations'),
      backupDir,
    });
  } finally {
    rmSync(backupDir, { recursive: true, force: true });
  }

  return () => {
    if (existsSync(dbPath)) rmSync(dbPath);
  };
}
