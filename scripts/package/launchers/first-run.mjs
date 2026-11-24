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
 * - Con `KRAKENOS_ENV_FROM_SYSTEM=1` (la unidad de systemd de los paquetes de Linux, que ya carga
 *   `/etc/krakenos/krakenos.env`) no crea nada: un segundo `.env` competiría con ese fichero.
 * - Sin `keys/jwt-private.pem`: ejecuta `app/agent/dist/keys.js gen`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
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

/** Fija `KEY=valor` (lo usan los paquetes de Linux y el instalador de Windows): reemplaza las líneas existentes (dejando una sola) o la añade si falta. */
export function setKey(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'gm');
  let seen = false;
  const out = text.replace(re, () => (seen++ ? '\0' : `${key}=${value}`)).replace(/\0\n?/g, '');
  return seen ? out : `${out}${out.endsWith('\n') || out === '' ? '' : '\n'}${key}=${value}\n`;
}

/** @returns {boolean} true si creó el `.env`; false si ya existía. */
export function ensureEnv(dataDir, templatePath) {
  const target = join(dataDir, '.env');
  // `lstat` y no `existsSync`: este código corre ELEVADO en el instalador de Windows y `existsSync` sigue
  // enlaces (un symlink colgante plantado daría false y se escribiría a través de él).
  let st = null;
  try {
    st = lstatSync(target);
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
  }
  if (st) {
    if (st.isSymbolicLink())
      throw new Error(`${target} es un enlace simbólico o junction: no se usa.`);
    if (!st.isFile() || st.nlink > 1)
      throw new Error(`${target} no es un fichero normal o es un enlace duro: no se usa.`);
    return false;
  }
  // `wx`: si entre medias se planta un enlace, falla en vez de seguirlo.
  writeFileSync(target, withKindsNone(readFileSync(templatePath, 'utf8')), {
    mode: 0o600,
    flag: 'wx',
  });
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
  const envDelSistema = process.env.KRAKENOS_ENV_FROM_SYSTEM === '1';
  if (!envDelSistema && ensureEnv(dataDir, join(appDir, 'agent', '.env.example'))) {
    console.log(`Configuración creada en ${join(dataDir, '.env')}`);
  }
  ensureKeys(dataDir, join(appDir, 'agent', 'dist', 'keys.js'));
}

// import.meta.main (Node >= 24.2) y no comparar con argv[1]: bajo un enlace simbólico no coinciden.
if (import.meta.main) {
  try {
    // Si el usuario movió la carpeta, los enlaces absolutos de pnpm en Windows quedan rotos.
    const nm = join(dirname(fileURLToPath(import.meta.url)), 'agent', 'node_modules');
    const { relinkPnpmJunctions } = await import('./relink.mjs');
    const r = await relinkPnpmJunctions(nm);
    if (r.relinked.length > 0)
      console.log(`Enlaces de dependencias rehechos: ${r.relinked.length}`);
    main();
  } catch (e) {
    console.error(`KrakenOS: no se pudo preparar el primer arranque: ${e.message}`);
    process.exit(1);
  }
}
