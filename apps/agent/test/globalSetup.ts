import { execSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Prepara la base de datos de pruebas una sola vez antes de toda la suite:
 * borra cualquier `test.db` previa y aplica las migraciones versionadas.
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

  execSync('pnpm exec prisma migrate deploy', {
    cwd: agentRoot,
    env: { ...process.env, DATABASE_URL: 'file:./test.db' },
    stdio: 'inherit',
  });

  return () => {
    if (existsSync(dbPath)) rmSync(dbPath);
  };
}
