import { MigrationError, type MigrateResult } from '../db/migrate.js';
import { revertAppliedRestore, type RestoreTargets } from './restore.js';

export interface AppliedRestore {
  preRestoreDir: string;
  targets: RestoreTargets;
  /** Destinos que la restauración creó (no existían antes): la reversión los retira. */
  added: string[];
}

/**
 * Migra tras una posible restauración. Si la base recién restaurada trae una migración
 * que este código no conoce (copia de una versión más nueva que se coló), devuelve la
 * base previa (`pre-restore-*`) y migra con ella: la alternativa es salir con 1 en cada
 * arranque, un bucle de reinicio que solo arregla una shell. Sin restauración reciente,
 * o con cualquier otro fallo, el error se propaga (arrancar adivinando no se hace).
 */
export function migrateWithRestoreSafety(opts: {
  restored: AppliedRestore | null;
  migrate: () => MigrateResult;
  log: (message: string) => void;
}): { result: MigrateResult; revertedRestore: boolean } {
  try {
    return { result: opts.migrate(), revertedRestore: false };
  } catch (err) {
    if (!opts.restored || !(err instanceof MigrationError) || err.code !== 'UNKNOWN_APPLIED') {
      throw err;
    }
    opts.log(
      `[restore] La copia restaurada es de una versión más nueva (migración «${err.migration ?? '?'}» ` +
        `desconocida): se devuelve la base anterior desde ${opts.restored.preRestoreDir}. ` +
        'El archivo .kbk original sigue disponible: actualiza KrakenOS y vuelve a restaurarlo. ' +
        'Si esta reversión fallara, la base anterior sigue en esa carpeta para rescatarla a mano.',
    );
    revertAppliedRestore(opts.restored.preRestoreDir, opts.restored.targets, opts.restored.added);
    return { result: opts.migrate(), revertedRestore: true };
  }
}
