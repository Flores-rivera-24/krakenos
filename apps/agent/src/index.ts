import 'dotenv/config';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from './config/env.js';
import { buildServer } from './server.js';
import { applyStagedRestore, resolveDbFile } from './system/restore.js';

/**
 * Aplica una restauración preparada (US-104) **antes** de abrir la base de datos:
 * coloca DB/keys/data del staging en su sitio, respaldando lo actual. Si no hay
 * staging, no hace nada. Se ejecuta una sola vez por reinicio.
 */
function applyPendingRestore(): void {
  const stagingDir = resolve('data/restore-staging');
  if (!existsSync(stagingDir)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const preRestoreDir = resolve(`data/pre-restore-${stamp}`);
  const applied = applyStagedRestore(
    stagingDir,
    {
      dbFile: resolveDbFile(process.env.DATABASE_URL ?? 'file:./dev.db'),
      keysDir: dirname(env.secretboxKeyPath),
      dataDir: resolve('data'),
    },
    preRestoreDir,
  );
  process.stdout.write(
    `[restore] Restauración aplicada: ${applied.length} ficheros. Copia previa en ${preRestoreDir}\n`,
  );
}

async function main(): Promise<void> {
  applyPendingRestore();
  const app = await buildServer();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info(`Recibido ${signal}, cerrando…`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: env.port, host: env.host });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
