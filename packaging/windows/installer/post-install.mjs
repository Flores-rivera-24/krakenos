/**
 * `node post-install.mjs install|stop|uninstall|setup-token [--lang es|en] [--version <v>] [--interactive] [--purge-data] [--update]`: lo ejecuta el instalador (elevado)
 * con el Node empaquetado, desde `Program Files\KrakenOS\installer`. Sale con código distinto de 0
 * y un mensaje ante cualquier fallo: nada de instalación a medias en silencio.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { createServer } from 'node:net';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { msg } from './mensajes.mjs';
import { readSetupToken, runInstall, showDialog, stopService, uninstallAll } from './steps.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const INSTALL_DIR = join(AQUI, '..');

function run(cmd, args, opciones = {}) {
  return new Promise((resolve, reject) => {
    // `cwd` fijo: nada se resuelve desde un directorio actual que no controlamos (el desinstalador corre desde %TEMP%).
    const p = spawn(cmd, args, {
      cwd: INSTALL_DIR,
      windowsHide: true,
      env: { ...process.env, ...opciones.env },
    });
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

/** https verifica contra la CA local recién creada (el agente sirve solo https en el puerto elegido). */
function makeGet(dataDir) {
  return (url) =>
    new Promise((resolve, reject) => {
      const opciones = { timeout: 3000 };
      if (url.startsWith('https'))
        opciones.ca = readFileSync(join(dataDir, 'tls', 'krakenos-ca.pem'));
      const r = (url.startsWith('https') ? httpsGet : httpGet)(url, opciones, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      r.on('timeout', () => r.destroy(new Error('timeout')));
      r.on('error', reject);
    });
}

/** En silencio nadie ve la consola del hook: queda junto al instalador (solo admin escribe). */
function registrar(texto) {
  try {
    appendFileSync(
      join(INSTALL_DIR, 'install-error.log'),
      `${new Date().toISOString()} ${texto}\n`,
    );
  } catch {
    /* sin log, el aviso se pierde; nunca se escribe por la consola */
  }
}

/** Quita los enlaces de `node_modules` que rehízo el hook, con el manifiesto del paquete; sin manifiesto, nada. */
async function quitarEnlaces() {
  const manifiesto = join(INSTALL_DIR, 'app', 'links.json');
  let links;
  try {
    links = JSON.parse(await fs.readFile(manifiesto, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  const { removeLinks } = await import('../app/links.mjs');
  await removeLinks(join(INSTALL_DIR, 'app', 'agent', 'node_modules'), links);
}

async function main() {
  const [orden, ...resto] = process.argv.slice(2);
  const lang = resto[resto.indexOf('--lang') + 1] === 'en' ? 'en' : 'es';
  // Sin `--interactive` (silencioso, o llamada a mano) no hay diálogos ni se cambia el perfil de red.
  const interactive = resto.includes('--interactive');
  const dataDir = process.env.ProgramData && join(process.env.ProgramData, 'KrakenOS');
  if (!dataDir) throw new Error('falta la variable ProgramData');
  const serviceExe = join(INSTALL_DIR, 'service', 'KrakenOS-service.exe');
  try {
    if (orden === 'install') {
      const { ensureEnv, ensureKeys, setKey } = await import('../app/first-run.mjs');
      // keys.js gen lee la carpeta de datos del entorno, como al lanzarlo krakenos.cmd.
      process.env.KRAKENOS_DATA_DIR = dataDir;
      process.env.KRAKENOS_APP_DIR = join(INSTALL_DIR, 'app', 'agent');
      const iv = resto.indexOf('--version');
      await runInstall({
        version: iv >= 0 ? resto[iv + 1] : undefined,
        installDir: INSTALL_DIR,
        dataDir,
        lang,
        run,
        fs,
        isFree,
        get: makeGet(dataDir),
        hostname: hostname(),
        setKey,
        ensureEnv: (d) => ensureEnv(d, join(INSTALL_DIR, 'app', 'agent', '.env.example')),
        ensureKeys: (d) => ensureKeys(d, join(INSTALL_DIR, 'app', 'agent', 'dist', 'keys.js')),
        log: (l) => console.log(l),
        interactive,
        ask: (text, title) => showDialog({ run, title, text, yesNo: true }),
        notify: (text, title) => showDialog({ run, title, text, yesNo: false }),
      });
    } else if (orden === 'setup-token') {
      // Solo el token por stdout (lo captura NSIS, que mezcla stdout y stderr): los avisos van al log.
      const token = await readSetupToken({
        file: join(dataDir, 'setup-token'),
        waitMs: 5000,
        fs,
        warn: (m) => registrar(`setup-token: ${m}`),
      });
      if (token) process.stdout.write(token);
    } else if (orden === 'stop') await stopService({ serviceExe, run });
    else if (orden === 'uninstall') {
      await uninstallAll({
        run,
        fs,
        dataDir,
        serviceExe,
        installDir: INSTALL_DIR,
        programFiles: process.env.ProgramW6432 ?? process.env.ProgramFiles,
        lang,
        purgeData: resto.includes('--purge-data'),
        update: resto.includes('--update'),
        log: (l) => console.log(l),
        removeLinks: quitarEnlaces,
      });
    } else throw new Error(`orden desconocida: ${orden}`);
  } catch (e) {
    const texto = msg(lang, orden === 'uninstall' ? 'falloDesinstalar' : 'fallo', e.message);
    console.error(texto);
    registrar(texto);
    process.exit(1);
  }
}

await main();
