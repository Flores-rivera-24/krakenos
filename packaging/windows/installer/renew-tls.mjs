/**
 * `node renew-tls.mjs <datos>`: lo ejecuta la tarea programada `\KrakenOS\RenovarTLS` como SYSTEM.
 * Vive en `Program Files` (solo Administradores escriben) y no importa nada de `node_modules`: lo que
 * SYSTEM ejecuta nunca puede ser algo que el servicio modifique. Su configuración sale de `ca\tls.json`
 * (solo SYSTEM y Administradores), NO del `.env`, que el servicio sí puede escribir.
 * `local-ca.js` reemite el certificado solo si caduca pronto o cambió la IP; el agente lo recarga en caliente.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function renew({ dataDir, localCa, node, readFile, run }) {
  const ruta = join(dataDir, 'ca', 'tls.json');
  const cfg = JSON.parse(readFile(ruta));
  for (const k of ['hostname', 'certsDir', 'keysDir'])
    if (typeof cfg?.[k] !== 'string' || !cfg[k]) throw new Error(`${ruta} no trae «${k}»`);
  const code = run(node, [localCa], {
    KRAKENOS_HOSTNAME: cfg.hostname,
    KRAKENOS_CERTS_DIR: cfg.certsDir,
    KRAKENOS_KEYS_DIR: cfg.keysDir,
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
      run: (cmd, args, env) =>
        spawnSync(cmd, args, { env: { ...process.env, ...env }, stdio: 'inherit' }).status ?? 1,
    });
  } catch (e) {
    console.error(`No se pudo renovar el certificado de KrakenOS: ${e.message}`);
    process.exit(1);
  }
}
