import { runVerifyCli } from './system/verify-update.js';
import { UPDATE_PUBLIC_KEY_PEM } from './system/update-signing-key.js';

/**
 * Verificador de actualizaciones por paquete (`node dist/verify-update.js`). Lo ejecuta ROOT desde
 * el helper sobre su copia del paquete; se compila autocontenido (`tsup.root.config.ts`).
 */
process.exitCode = await runVerifyCli(process.argv.slice(2), UPDATE_PUBLIC_KEY_PEM, (l) =>
  process.stderr.write(`${l}\n`),
);
