/**
 * Preparación del primer arranque del paquete autocontenido (US-284).
 *
 * Los lanzadores (`krakenos.cmd`, `bin/krakenos`) lo invocan como
 * `node app/first-run.mjs`, con el cwd en el directorio de datos y las variables ya fijadas.
 * Vive aquí, y no en batch, porque reescribir un `.env` en un `.cmd` es frágil.
 *
 * - Sin `<datos>/.env`: lo crea desde `app/agent/.env.example` con los ocho `*_KIND=none`
 *   (igual que `scripts/install.sh`: una instalación real no arranca en `mock`). Si ya existe,
 *   no se toca: conserva lo que el usuario eligiera.
 * - Sin `keys/jwt-private.pem`: ejecuta `app/agent/dist/keys.js gen`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const KIND_VARS = ['DRIVER', 'VPN', 'IOT', 'CAMERAS', 'FIREWALL', 'VLAN', 'QOS', 'DNS'];

/** Pone los ocho `<X>_KIND` a `none` en el texto de la plantilla. */
export function withKindsNone(template) {
  let out = template;
  for (const v of KIND_VARS) {
    out = out.replace(new RegExp(`^${v}_KIND=.*$`, 'm'), `${v}_KIND=none`);
  }
  return out;
}

/** @returns {boolean} true si creó el `.env`; false si ya existía. */
export function ensureEnv(dataDir, templatePath) {
  const target = join(dataDir, '.env');
  if (existsSync(target)) return false;
  writeFileSync(target, withKindsNone(readFileSync(templatePath, 'utf8')), { mode: 0o600 });
  return true;
}

/** @returns {boolean} true si generó las claves; false si ya estaban. */
export function ensureKeys(dataDir, keysScript, run = defaultRun) {
  if (existsSync(join(dataDir, 'keys', 'jwt-private.pem'))) return false;
  const code = run(process.execPath, [keysScript, 'gen'], dataDir);
  if (code !== 0) throw new Error(`keys.js gen terminó con código ${code}`);
  return true;
}

function defaultRun(cmd, args, cwd) {
  return spawnSync(cmd, args, { cwd, stdio: 'inherit' }).status ?? 1;
}

export function main(dataDir = process.cwd()) {
  const appDir = dirname(fileURLToPath(import.meta.url));
  if (ensureEnv(dataDir, join(appDir, 'agent', '.env.example'))) {
    console.log(`Configuración creada en ${join(dataDir, '.env')}`);
  }
  ensureKeys(dataDir, join(appDir, 'agent', 'dist', 'keys.js'));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (e) {
    console.error(`KrakenOS: no se pudo preparar el primer arranque: ${e.message}`);
    process.exit(1);
  }
}
