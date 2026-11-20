/**
 * `node post-install.mjs install|stop|uninstall [--lang es|en]`: lo ejecuta el instalador (elevado)
 * con el Node empaquetado, desde `Program Files\KrakenOS\installer`. Sale con código distinto de 0
 * y un mensaje ante cualquier fallo: nada de instalación a medias en silencio.
 */
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { msg } from './mensajes.mjs';
import { runInstall, stopService, uninstallService } from './steps.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const INSTALL_DIR = join(AQUI, '..');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    p.stdout.on('data', (c) => (stdout += c));
    p.stderr.on('data', (c) => (stdout += c));
    p.on('error', reject);
    p.on('close', (code) => resolve({ code: code ?? 1, stdout }));
  });
}

/** Libre solo si se puede abrir en loopback Y en todas las interfaces (la WSL ocupa 3001 en loopback). */
function isFree(port) {
  const probar = (host) =>
    new Promise((resolve) => {
      const s = createServer();
      s.once('error', () => resolve(false));
      s.listen(port, host, () => s.close(() => resolve(true)));
    });
  return probar('127.0.0.1').then((a) => (a ? probar('0.0.0.0') : false));
}

function get(url) {
  return new Promise((resolve, reject) => {
    const r = httpGet(url, { timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    r.on('timeout', () => r.destroy(new Error('timeout')));
    r.on('error', reject);
  });
}

async function main() {
  const [orden, ...resto] = process.argv.slice(2);
  const lang = resto[resto.indexOf('--lang') + 1] === 'en' ? 'en' : 'es';
  const dataDir = process.env.ProgramData && join(process.env.ProgramData, 'KrakenOS');
  if (!dataDir) throw new Error('falta la variable ProgramData');
  const serviceExe = join(INSTALL_DIR, 'service', 'KrakenOS-service.exe');
  try {
    if (orden === 'install') {
      const { ensureEnv, ensureKeys, setKey } = await import('../app/first-run.mjs');
      // keys.js gen lee la carpeta de datos del entorno, como al lanzarlo krakenos.cmd.
      process.env.KRAKENOS_DATA_DIR = dataDir;
      process.env.KRAKENOS_APP_DIR = join(INSTALL_DIR, 'app', 'agent');
      await runInstall({
        installDir: INSTALL_DIR,
        dataDir,
        lang,
        run,
        fs,
        isFree,
        get,
        setKey,
        ensureEnv: (d) => ensureEnv(d, join(INSTALL_DIR, 'app', 'agent', '.env.example')),
        ensureKeys: (d) => ensureKeys(d, join(INSTALL_DIR, 'app', 'agent', 'dist', 'keys.js')),
        log: (l) => console.log(l),
      });
    } else if (orden === 'stop') await stopService({ serviceExe, run });
    else if (orden === 'uninstall') await uninstallService({ serviceExe, run });
    else throw new Error(`orden desconocida: ${orden}`);
  } catch (e) {
    console.error(msg(lang, 'fallo', e.message));
    process.exit(1);
  }
}

await main();
