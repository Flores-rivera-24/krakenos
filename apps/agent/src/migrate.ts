import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { MigrationError, migrateFromEnv } from './db/migrate.js';

/**
 * CLI de migraciones (`node dist/migrate.js`, o `tsx src/migrate.ts` en desarrollo):
 * migra la base de `DATABASE_URL` y sale con código distinto de 0 nombrando la causa.
 * Lo usan el instalador, `pnpm prod`, el entrypoint de Docker, el actualizador y los
 * e2e, en lugar de `prisma migrate deploy` (US-275).
 *
 * Se ancla al directorio del agente (el padre de `dist/` o `src/`), no al cwd del
 * llamador: así el `.env`, `prisma/migrations` y las rutas `file:./…` se resuelven
 * igual lo lance quien lo lance.
 */
function main(): void {
  process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  dotenv.config();
  try {
    const { applied } = migrateFromEnv((m) => process.stdout.write(`${m}\n`));
    process.stdout.write(
      applied.length === 0
        ? '[migrate] Base al día: no hay migraciones pendientes.\n'
        : `[migrate] ${applied.length} migraciones aplicadas.\n`,
    );
  } catch (err) {
    const code = err instanceof MigrationError ? ` (${err.code})` : '';
    process.stderr.write(
      `[migrate] ERROR${code}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}

main();
