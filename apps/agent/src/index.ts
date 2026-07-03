import 'dotenv/config';
import { existsSync, renameSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { env } from './config/env.js';
import { buildServer } from './server.js';
import { applyStagedRestore, resolveDbFile } from './system/restore.js';

/**
 * Aplica una restauración preparada (US-104) **antes** de abrir la base de datos:
 * coloca DB/keys/data del staging en su sitio, respaldando lo actual. El staging y
 * las copias previas viven en `var/` (FUERA de `data/`, que es un destino de restore,
 * si no colisionarían). NUNCA propaga el error: si algo falla, aparta el staging y
 * continúa el arranque, de modo que un backup dañado/incompleto no deje la caja en un
 * bucle de reinicio (era un riesgo real en hardware desatendido).
 */
function applyPendingRestore(): void {
  const stagingDir = resolve('var/restore-staging');
  if (!existsSync(stagingDir)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const preRestoreDir = resolve(`var/pre-restore-${stamp}`);
  try {
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
  } catch (err) {
    const failedDir = resolve(`var/restore-failed-${stamp}`);
    try {
      renameSync(stagingDir, failedDir);
    } catch {
      rmSync(stagingDir, { recursive: true, force: true });
    }
    const msg = err instanceof Error ? err.message : 'error desconocido';
    process.stderr.write(
      `[restore] La restauración FALLÓ (${msg}); se aparta en ${failedDir} y se continúa el arranque. ` +
        `Copia previa (rescate) en ${preRestoreDir}.\n`,
    );
  }
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
