/**
 * `node renew-tls.mjs <datos>`: lo ejecuta la tarea programada `\KrakenOS\RenovarTLS` como SYSTEM.
 * Vive en `Program Files` (solo Administradores escriben) y no importa nada de `node_modules`: lo que
 * SYSTEM ejecuta nunca puede ser algo que el servicio modifique. Del fichero `ca\tls.json` (solo SYSTEM y
 * Administradores) solo usa el nombre de host; las carpetas se derivan de `<datos>`. NO lee el `.env`.
 * `local-ca.js` reemite el certificado solo si caduca pronto o cambió la IP; el agente lo recarga en caliente.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const norm = (p) =>
  String(p).replaceAll('\\', '/').replace(/\/+/g, '/').replace(/\/$/, '').toLowerCase();

/**
 * `certsDir`/`keysDir` NO salen de `tls.json` (el servicio puede renombrar la raíz de datos y plantar una
 * junction con un `tls.json` suyo): se derivan de `dataDir`, que viaja en la tarea que escribió el
 * instalador, y antes de nada se comprueba con `realpath` que las tres carpetas son reales, sin junctions.
 */
export async function renew({ dataDir, localCa, node, readFile, realpath, run }) {
  const certsDir = join(dataDir, 'tls');
  const keysDir = join(dataDir, 'ca');
  for (const d of [dataDir, keysDir, certsDir]) {
    let real;
    try {
      real = realpath(d);
    } catch (e) {
      throw new Error(`no se puede comprobar ${d}: ${e.message}`);
    }
    if (norm(real) !== norm(d))
      throw new Error(`${d} no es una carpeta real (resuelve a ${real}): se aborta la renovación`);
  }
  const ruta = join(keysDir, 'tls.json');
  const cfg = JSON.parse(readFile(ruta));
  // Solo el nombre de host sale del fichero, con el alfabeto de un nombre de host.
  if (typeof cfg?.hostname !== 'string' || !/^[A-Za-z0-9-]{1,63}$/.test(cfg.hostname))
    throw new Error(`${ruta} no trae un «hostname» válido`);
  const code = run(node, [localCa], {
    KRAKENOS_HOSTNAME: cfg.hostname,
    KRAKENOS_CERTS_DIR: certsDir,
    KRAKENOS_KEYS_DIR: keysDir,
  });
  if (code !== 0) throw new Error(`local-ca.js salió con ${code}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dataDir = process.argv[2];
  if (!dataDir) {
    console.error('uso: renew-tls.mjs <carpeta de datos>');
    process.exit(2);
  }
  const instalado = join(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    await renew({
      dataDir,
      node: process.execPath,
      localCa: join(instalado, 'app', 'agent', 'dist', 'local-ca.js'),
      readFile: (p) => readFileSync(p, 'utf8'),
      realpath: (p) => realpathSync(p),
      run: (cmd, args, env) =>
        spawnSync(cmd, args, { env: { ...process.env, ...env }, stdio: 'inherit' }).status ?? 1,
    });
  } catch (e) {
    console.error(`No se pudo renovar el certificado de KrakenOS: ${e.message}`);
    process.exit(1);
  }
}
