import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runKeysCli } from './crypto/keys.js';

/**
 * CLI de claves (`node dist/keys.js gen|rotate`, o `tsx src/keys.ts gen` en desarrollo):
 * genera el par RS256 de los JWT y la clave de secretbox, o rota el par con solape.
 * Sustituye a `gen-keys.sh` y `rotate-keys.sh` (US-277); la lógica vive en
 * `crypto/keys.ts`. Se ancla al directorio del agente (el padre de `dist/` o `src/`).
 */
const agentDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.exitCode = runKeysCli(process.argv.slice(2), process.env, agentDir, {
  out: (l) => process.stdout.write(`${l}\n`),
  err: (l) => process.stderr.write(`${l}\n`),
});
