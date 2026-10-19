import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLocalCaCli } from './crypto/local-ca.js';

/**
 * CLI de la CA local (`node dist/local-ca.js`): crea la CA si falta y emite o renueva el
 * certificado TLS del agente. Sustituye a `gen-local-ca.sh` (US-277) con las mismas
 * variables `KRAKENOS_*`; la lógica vive en `crypto/local-ca.ts`.
 *
 * Este fichero se compila además en UN solo fichero autocontenido
 * (`tsup.root.config.ts`) que el instalador copia a `/usr/local/lib/krakenos/`, porque el
 * timer de renovación lo ejecuta como root.
 */
const agentDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.exitCode = await runLocalCaCli(process.env, agentDir, {
  out: (l) => process.stdout.write(`${l}\n`),
  err: (l) => process.stderr.write(`${l}\n`),
});
