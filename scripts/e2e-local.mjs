/**
 * `pnpm test:e2e:local [--no-build] [argumentos de Playwright…]`
 *
 * Corre la suite e2e en la máquina del desarrollador (WSL incluido) comprobando de
 * antemano lo que, si falla, falla de forma que no se parece a su causa:
 *
 *   1. el puerto fijo de la suite (`E2E_PORT`, de `e2e/lib/server.ts`) está libre;
 *   2. el sistema tiene las librerías de Chromium (o existe el apaño sin root de
 *      `docs/e2e.md`, que se usa vía `LD_LIBRARY_PATH`);
 *   3. el Chromium de la versión de Playwright del repo está instalado;
 *   4. el build está al día (se ejecuta `pnpm build`, salvo `--no-build`).
 *
 * Luego lanza el Playwright LOCAL (nunca `npx`: el `.npmrc` de pnpm hace que npm
 * imprima avisos de configuración) con reporter `list` + `html` sin abrir el
 * informe, y propaga su código de salida. **No mata ningún proceso ni instala nada.**
 *
 * La lógica de decisión son funciones puras exportadas (probadas en
 * `apps/agent/test/unit/e2e-local.test.ts`); el efecto vive en `main()`.
 *
 * Variables de PRUEBA (no hacen falta en uso normal):
 *   E2E_LOCAL_LIBS=faltan|presentes   fuerza el resultado de la comprobación de libs
 *   E2E_LOCAL_APANO_DIR=<dir>         dirección alternativa del apaño sin root
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
// Una sola fuente del puerto: Node 24 ejecuta el .ts quitando los tipos.
import { E2E_PORT, puertoOcupado } from '../e2e/lib/server.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INFORME = join(ROOT, 'e2e', 'playwright-report');
const TRAZAS = join(ROOT, 'e2e', 'test-results');
const PID_FILE = join(ROOT, 'e2e', '.server.pid');
const APANO_POR_DEFECTO = join(
  homedir(),
  '.cache/krakenos/playwright-deps/root/usr/lib/x86_64-linux-gnu',
);
const LIBS_NECESARIAS = ['libnspr4.so', 'libnss3.so'];

// ─── Funciones puras ────────────────────────────────────────────────────────

/** Separa nuestro flag `--no-build` del resto, que pasa tal cual a Playwright. */
export function parseArgs(argv) {
  const build = !argv.includes('--no-build');
  return { build, resto: argv.filter((a) => a !== '--no-build') };
}

/** Proyectos pedidos con `--project=x` / `--project x` (vacío = todos). */
export function proyectosPedidos(args) {
  const out = [];
  args.forEach((a, i) => {
    if (a.startsWith('--project=')) out.push(a.slice('--project='.length));
    else if (a === '--project' && args[i + 1]) out.push(args[i + 1]);
  });
  return out;
}

/** Chromium hace falta salvo que se pidan SOLO proyectos de Firefox. */
export function necesitaChromium(args) {
  const proyectos = proyectosPedidos(args);
  return proyectos.length === 0 || proyectos.some((p) => p !== 'firefox');
}

/**
 * Mensaje (y código de salida) cuando el puerto está ocupado. `procesos` =
 * `[{ pid, comando }]`; `pidDeEstaSuite` = el de `e2e/.server.pid`, si existe.
 */
export function mensajePuertoOcupado(puerto, procesos, pidDeEstaSuite = null) {
  const lineas = [`El puerto ${puerto} (fijo en la suite e2e) está ocupado.`];
  if (procesos.length === 0) {
    lineas.push(
      'No he podido saber qué proceso lo tiene (¿falta `lsof`?). Búscalo con: ss -ltnp | grep :' +
        puerto,
    );
  }
  for (const { pid, comando } of procesos) {
    lineas.push(`  PID ${pid}: ${comando || '(comando desconocido)'}`);
    if (pidDeEstaSuite !== null && String(pid) === String(pidDeEstaSuite)) {
      lineas.push('  (es el agente de una ejecución e2e anterior de este mismo checkout)');
    }
  }
  const pids = procesos.map((p) => p.pid);
  lineas.push(
    pids.length
      ? `Si es tuyo y puedes pararlo: ${pids.map((p) => `kill -TERM ${p}`).join(' && ')}  (nunca -9; yo no mato nada). Después, reintenta.`
      : 'Páralo con `kill -TERM <pid>` (nunca -9; yo no mato nada) y reintenta.',
  );
  return lineas.join('\n');
}

/** ¿La salida de `ldconfig -p` incluye todas las librerías que necesita Chromium? */
export function libsPresentes(salidaLdconfig) {
  return LIBS_NECESARIAS.every((lib) => salidaLdconfig.includes(lib));
}

/**
 * Qué hacer con las librerías de Chromium.
 * @returns {{ accion: 'nada' | 'apano' | 'abortar', ldLibraryPath?: string, mensaje?: string }}
 */
export function decidirLibs({ plataforma, libsDelSistema, apanoDir, apanoExiste, playwrightBin }) {
  if (plataforma !== 'linux' || libsDelSistema) return { accion: 'nada' };
  if (apanoExiste) {
    return {
      accion: 'apano',
      ldLibraryPath: apanoDir,
      mensaje: `Faltan libnspr4/libnss3 en el sistema: uso el apaño sin root (LD_LIBRARY_PATH=${apanoDir}).`,
    };
  }
  return {
    accion: 'abortar',
    mensaje: [
      'Faltan las librerías del sistema que Chromium necesita (libnspr4, libnss3…) y no existe el apaño sin root.',
      'Dos salidas:',
      // `sudo` pierde el PATH de nvm: se le pasa el nuestro y la ruta del binario local.
      `  1. Con sudo:  sudo env "PATH=$PATH" ${playwrightBin} install-deps chromium`,
      '  2. Sin sudo:  rehacer el apaño de docs/e2e.md (sección «Si Chromium no arranca»), que deja las libs en',
      `     ${apanoDir}`,
    ].join('\n'),
  };
}

/** Antepone el apaño al `LD_LIBRARY_PATH` que ya hubiera. */
export function ldLibraryPathCon(dir, actual) {
  return actual ? `${dir}:${actual}` : dir;
}

/** Mensaje cuando falta el Chromium de la versión de Playwright del repo. */
export function mensajeSinNavegador(faltan) {
  return [
    `Falta el navegador de esta versión de Playwright (no encuentro: ${faltan.join(', ')}).`,
    'Instálalo una vez con:  pnpm test:e2e:install   (no lo hago yo solo: descarga ~200 MB).',
  ].join('\n');
}

/** Cierre: cómo abrir el informe y dónde están las trazas. */
export function resumenFinal({ informeExiste, trazasExisten, codigo }) {
  const l = [''];
  l.push(codigo === 0 ? 'Suite e2e: OK.' : `Suite e2e: terminó con código ${codigo}.`);
  if (informeExiste) {
    l.push('Informe HTML:  pnpm exec playwright show-report e2e/playwright-report');
  }
  if (trazasExisten) {
    l.push(
      'Trazas, vídeos y capturas de lo que falló: e2e/test-results/  ' +
        '(abre una con: pnpm exec playwright show-trace e2e/test-results/<carpeta>/trace.zip)',
    );
  }
  return l.join('\n');
}

// ─── Efectos ────────────────────────────────────────────────────────────────

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function quienTieneElPuerto(puerto) {
  const pids = sh('lsof', ['-t', `-iTCP:${puerto}`, '-sTCP:LISTEN'])
    .split('\n')
    .filter(Boolean);
  return [...new Set(pids)].map((pid) => ({ pid, comando: sh('ps', ['-o', 'args=', '-p', pid]) }));
}

function leerPidDeEstaSuite() {
  try {
    return readFileSync(PID_FILE, 'utf8').trim() || null;
  } catch {
    return null;
  }
}

function libsDelSistema() {
  const forzado = process.env.E2E_LOCAL_LIBS;
  if (forzado === 'faltan') return false;
  if (forzado === 'presentes') return true;
  return libsPresentes(sh('ldconfig', ['-p']));
}

/** Directorios del Chromium (y su headless shell) que debería haber instalado. */
function navegadoresQueFaltan(chromium) {
  const exe = chromium.executablePath();
  const dir = dirname(dirname(exe)); // …/ms-playwright/chromium-NNNN
  const headless = dir.replace(/chromium-(\d+)$/, 'chromium_headless_shell-$1');
  return [dir, headless].filter((d) => !existsSync(join(d, 'INSTALLATION_COMPLETE')));
}

function fallar(mensaje, codigo = 1) {
  console.error(`\n[e2e:local] ${mensaje}\n`);
  process.exit(codigo);
}

async function main() {
  const { build, resto } = parseArgs(process.argv.slice(2));
  const env = { ...process.env };

  // 1. Puerto
  if (await puertoOcupado(E2E_PORT)) {
    fallar(mensajePuertoOcupado(E2E_PORT, quienTieneElPuerto(E2E_PORT), leerPidDeEstaSuite()));
  }

  // 2. Librerías de Chromium (solo Linux)
  const require = createRequire(import.meta.url);
  const { chromium } = require('@playwright/test');
  if (necesitaChromium(resto)) {
    const apanoDir = process.env.E2E_LOCAL_APANO_DIR || APANO_POR_DEFECTO;
    const decision = decidirLibs({
      plataforma: process.platform,
      libsDelSistema: process.platform !== 'linux' || libsDelSistema(),
      apanoDir,
      apanoExiste: LIBS_NECESARIAS.every((l) => existsSync(join(apanoDir, l))),
      playwrightBin: join(ROOT, 'node_modules', '.bin', 'playwright'),
    });
    if (decision.accion === 'abortar') fallar(decision.mensaje);
    if (decision.accion === 'apano') {
      env.LD_LIBRARY_PATH = ldLibraryPathCon(decision.ldLibraryPath, env.LD_LIBRARY_PATH);
      console.log(`[e2e:local] ${decision.mensaje}`);
    }

    // 3. Navegador
    const faltan = navegadoresQueFaltan(chromium);
    if (faltan.length > 0) fallar(mensajeSinNavegador(faltan));
  }

  // 4. Build
  if (build) {
    console.log('[e2e:local] pnpm build (la suite corre contra el build; --no-build lo salta)…');
    const r = spawnSync('pnpm', ['build'], {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (r.status !== 0)
      fallar('`pnpm build` falló: no lanzo la suite contra un build roto.', r.status ?? 1);
  }

  // 5. Playwright local
  const cli = require.resolve('@playwright/test/cli');
  console.log('[e2e:local] playwright test…');
  // Ctrl+C llega a todo el grupo: el hijo limpia (teardown del agente) y nosotros esperamos.
  process.on('SIGINT', () => {});
  const r = spawnSync(
    process.execPath,
    [cli, 'test', '-c', 'e2e/playwright.config.ts', '--reporter=list,html', ...resto],
    {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...env, PLAYWRIGHT_HTML_OUTPUT_DIR: INFORME, PLAYWRIGHT_HTML_OPEN: 'never' },
    },
  );
  const codigo = r.status ?? (r.signal ? 1 : 0);
  console.log(
    resumenFinal({
      informeExiste: existsSync(join(INFORME, 'index.html')),
      trazasExisten: existsSync(TRAZAS) && readdirSync(TRAZAS).some((f) => !f.startsWith('.')),
      codigo,
    }),
  );
  process.exit(codigo);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
