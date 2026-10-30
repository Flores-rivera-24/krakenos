/**
 * Smoke del paquete autocontenido (US-284): `node scripts/package-smoke.mjs <carpeta>`.
 *
 * Arranca el lanzador del paquete con datos temporales y un puerto libre, comprueba
 * `/health/ready` y que `GET /` sirve la web, para el agente como lo haría un usuario y
 * exige que no queden `-wal`/`-shm`. Luego repite sobre los MISMOS datos tras renombrar la
 * carpeta del paquete a otra con un espacio en el nombre: es el caso que rompió el paquete en
 * Windows (los enlaces de pnpm son absolutos y `relink.mjs` los rehace al arrancar).
 *
 * - Linux: se para con `SIGTERM`.
 * - Windows: Node no puede mandar Ctrl+C a un hijo, así que el lanzador se arranca con consola
 *   propia (`cmd /c start`, ver `lineaStartWindows`) y `scripts/package/ctrlc.ps1` se la manda
 *   desde fuera. La salida va a un fichero de log, de donde se lee el pid de node. `taskkill /F` sobre
 *   node no vale: mata sin avisar y deja el WAL.
 */
/* global AbortSignal */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renombrarConReintento } from './package/rename-retry.mjs';

const WIN = process.platform === 'win32';
const AQUI = dirname(fileURLToPath(import.meta.url));
const ESPERA_ARRANQUE_MS = 30_000;
const ESPERA_PARADA_MS = 20_000;

/** Rutas (relativas, con `/`) de los `-wal`/`-shm` que quedan bajo `dataDir`. */
export function findWalLeftovers(dataDir) {
  const found = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.db-(wal|shm)$/.test(e.name))
        found.push(relative(dataDir, p).split('\\').join('/'));
    }
  };
  if (existsSync(dataDir)) walk(dataDir);
  return found;
}

/** Ficheros que el primer arranque crea y el segundo no puede regenerar ni tocar. */
export const FICHEROS_DE_ESTADO = ['keys/jwt-private.pem', 'keys/secretbox.key', '.env'];

/** sha256 de cada fichero de estado bajo `dataDir` (`null` si falta). */
export function huellasDeEstado(dataDir) {
  const out = {};
  for (const f of FICHEROS_DE_ESTADO) {
    const ruta = join(dataDir, f);
    out[f] = existsSync(ruta)
      ? createHash('sha256').update(readFileSync(ruta)).digest('hex')
      : null;
  }
  return out;
}

/** Lanza nombrando el primer fichero cuya huella cambió (o desapareció) entre dos lecturas. */
export function assertEstadoConservado(antes, despues) {
  for (const f of FICHEROS_DE_ESTADO) {
    if (antes[f] === null) throw new Error(`${f} no existía tras el primer arranque`);
    if (antes[f] !== despues[f])
      throw new Error(`${f} cambió o desapareció entre el primer y el segundo arranque`);
  }
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function puertoLibre() {
  return new Promise((ok, fallo) => {
    const s = createServer();
    s.on('error', fallo);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

function vivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function esperarA(cond, ms, texto) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (await cond()) return;
    await dormir(250);
  }
  throw new Error(texto);
}

/**
 * Argumentos (en un solo texto, para `windowsVerbatimArguments`) con los que `cmd.exe` abre
 * una consola NUEVA y minimizada (`start`) que ejecuta el lanzador y vuelca su salida en `log`.
 * Sin consola propia no hay a quién mandarle Ctrl+C: `spawn({ detached })` en Windows crea el
 * proceso sin consola y `AttachConsole` falla. Las comillas dobles exteriores son las que `cmd /c` quita.
 */
export function lineaStartWindows(lanzador, log) {
  return `/d /c start "krakenos-smoke" /min cmd.exe /d /c ""${lanzador}" > "${log}" 2>&1"`;
}

/** pid de node: pino escribe `"pid":N` en cada línea. `null` si el log aún no lo trae. */
export function parsePidDeLog(texto) {
  const m = /"pid":(\d+)/.exec(texto);
  return m ? Number(m[1]) : null;
}

/** Borra una carpeta temporal sin tapar el error que la dejó ocupada: avisa y sigue. */
function borrarSinTapar(ruta) {
  try {
    rmSync(ruta, { recursive: true, force: true });
  } catch (e) {
    console.error(`    no se pudo borrar ${ruta}: ${e.message}`);
  }
}

function pidPadre(pid) {
  const r = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').ParentProcessId`,
    ],
    { encoding: 'utf8' },
  );
  const n = Number((r.stdout ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** Arranca el lanzador; devuelve lo necesario para sondearlo y pararlo. */
function arrancar(pkg, env) {
  const lanzador = WIN ? join(pkg, 'krakenos.cmd') : join(pkg, 'bin', 'krakenos');
  if (WIN) {
    // El log vive fuera de la carpeta de datos, en su propia carpeta temporal.
    const logDir = mkdtempSync(join(tmpdir(), 'krakenos-smoke-log-'));
    const log = join(logDir, 'agente.log');
    const hijo = spawn('cmd.exe', [lineaStartWindows(lanzador, log)], {
      env,
      windowsVerbatimArguments: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    // El cmd de spawn sale enseguida con 0: no dice nada de si el agente vive.
    const st = {
      logDir,
      log,
      nodePid: null,
      padrePid: null,
      get salida() {
        return existsSync(log) ? readFileSync(log, 'utf8') : '';
      },
      get cerro() {
        return this.nodePid !== null && !vivo(this.nodePid);
      },
    };
    return { hijo, st };
  }
  const hijo = spawn(lanzador, [], { env });
  const st = { salida: '', cerro: false, nodePid: hijo.pid };
  const recoge = (d) => {
    st.salida += d.toString();
  };
  hijo.stdout.on('data', recoge);
  hijo.stderr.on('data', recoge);
  hijo.on('close', () => {
    st.cerro = true;
  });
  return { hijo, st };
}

async function sondear(url, st) {
  if (WIN && st.nodePid === null) st.nodePid = parsePidDeLog(st.salida);
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) }).catch(() => null);
  if (!res && st.cerro) throw new Error(`el agente salió antes de responder:\n${st.salida}`);
  return res;
}

async function parar({ hijo, st }) {
  if (WIN) {
    st.nodePid ??= parsePidDeLog(st.salida);
    if (st.nodePid === null) throw new Error(`no se vio el pid de node en el log:\n${st.salida}`);
    // El padre de node es el cmd interior; hay que saberlo ANTES de que node salga.
    st.padrePid = pidPadre(st.nodePid);
    // Un runner de CI hereda «ignorar Ctrl+C» (SetConsoleCtrlHandler(NULL, TRUE)) y node ni se entera:
    // si tras Ctrl+C sigue vivo, se prueba con Ctrl+Pausa (SIGBREAK, que el agente también atiende).
    const mandar = (evento) => {
      const ps = spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          join(AQUI, 'package', 'ctrlc.ps1'),
          '-TargetPid',
          String(st.nodePid),
          '-Event',
          String(evento),
        ],
        { encoding: 'utf8' },
      );
      // 0xC000013A (STATUS_CONTROL_C_EXIT): Ctrl+Pausa también llega al propio powershell, que no lo ignora.
      const murioPorElEvento = evento === 1 && ps.status === 0xc000013a;
      if (ps.status !== 0 && !murioPorElEvento)
        throw new Error(`ctrlc.ps1 falló (${ps.status}): ${ps.stdout}${ps.stderr}`);
    };
    mandar(0);
    const salioConCtrlC = await esperarA(() => !vivo(st.nodePid), 5_000, 'sigue vivo').then(
      () => true,
      () => false,
    );
    if (!salioConCtrlC) {
      console.log('    node ignoró Ctrl+C; se manda Ctrl+Pausa (SIGBREAK)');
      mandar(1);
      await esperarA(
        () => !vivo(st.nodePid),
        ESPERA_PARADA_MS,
        `node (pid ${st.nodePid}) no salió tras Ctrl+C ni Ctrl+Pausa`,
      );
    }
    // El cmd interior se queda en «Terminate batch job (Y/N)?»; node ya salió, así que /F es seguro.
    if (st.padrePid !== null) {
      spawnSync('taskkill', ['/PID', String(st.padrePid), '/T', '/F']);
      // Sin esperar, el cmd aún tiene la carpeta del paquete como cwd/handle y el rename da EPERM.
      await esperarA(
        () => !vivo(st.padrePid),
        ESPERA_PARADA_MS,
        `el cmd envoltorio (pid ${st.padrePid}) no salió tras taskkill`,
      );
    }
  } else {
    hijo.kill('SIGTERM');
    await esperarA(() => st.cerro, ESPERA_PARADA_MS, 'el agente no salió tras SIGTERM');
  }
}

/** Limpieza de último recurso si algo falló antes de parar con normalidad. */
function matar({ hijo, st }) {
  if (WIN) {
    st.nodePid ??= parsePidDeLog(st.salida);
    if (st.nodePid !== null && vivo(st.nodePid)) {
      st.padrePid ??= pidPadre(st.nodePid);
      spawnSync('taskkill', ['/PID', String(st.nodePid), '/T', '/F']);
    }
    if (st.padrePid !== null) spawnSync('taskkill', ['/PID', String(st.padrePid), '/T', '/F']);
  } else if (!st.cerro) {
    hijo.kill('SIGTERM');
  }
}

async function ronda(etiqueta, pkg, env, port) {
  console.log(`==> ${etiqueta}: arrancando ${pkg}`);
  const p = arrancar(pkg, env);
  try {
    const base = `http://127.0.0.1:${port}`;
    let ready = null;
    await esperarA(
      async () => {
        ready = await sondear(`${base}/health/ready`, p.st);
        return ready?.status === 200;
      },
      ESPERA_ARRANQUE_MS,
      `/health/ready no dio 200 en ${ESPERA_ARRANQUE_MS / 1000} s (último: ${ready?.status ?? 'sin respuesta'}):\n${p.st.salida}`,
    );
    console.log('    /health/ready 200');
    const web = await fetch(`${base}/`, { signal: AbortSignal.timeout(5000) });
    const tipo = web.headers.get('content-type') ?? '';
    if (web.status !== 200 || !tipo.includes('text/html')) {
      throw new Error(`GET / no sirve la web: ${web.status} ${tipo}`);
    }
    console.log(`    GET / 200 ${tipo}`);
    await parar(p);
    console.log('    parado');
  } catch (e) {
    matar(p);
    throw e;
  } finally {
    if (WIN) borrarSinTapar(p.st.logDir);
  }
}

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error('uso: node scripts/package-smoke.mjs <carpeta del paquete>');
  const pkg = resolve(arg);
  if (!existsSync(pkg)) throw new Error(`no existe la carpeta ${pkg}`);

  const datos = mkdtempSync(join(tmpdir(), 'krakenos-smoke-'));
  const port = await puertoLibre();
  const env = { ...process.env, KRAKENOS_DATA_DIR: datos, PORT: String(port), HOST: '127.0.0.1' };
  const movida = `${pkg} movido`;
  try {
    await ronda('primer arranque', pkg, env, port);
    const antes = huellasDeEstado(datos);

    await renombrarConReintento(pkg, movida);
    console.log(`==> carpeta renombrada a ${movida}`);
    let falloDeRonda = false;
    try {
      await ronda('segundo arranque (carpeta movida)', movida, env, port);
    } catch (e) {
      falloDeRonda = true;
      throw e;
    } finally {
      // Si esto falla no debe tapar el error original de la ronda: se avisa y se conserva.
      try {
        await renombrarConReintento(movida, pkg);
        console.log(`==> carpeta devuelta a ${pkg}`);
      } catch (e) {
        console.error(`    no se pudo devolver ${movida} a ${pkg}: ${e.message}`);
        if (!falloDeRonda) throw e;
      }
    }
    assertEstadoConservado(antes, huellasDeEstado(datos));
    console.log('==> claves y .env intactos tras el segundo arranque');

    const restos = findWalLeftovers(datos);
    if (restos.length > 0)
      throw new Error(`quedaron ficheros WAL tras parar: ${restos.join(', ')}`);
    console.log('==> findWalLeftovers: []');
    console.log('Smoke OK');
  } finally {
    borrarSinTapar(datos);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`Smoke FALLÓ: ${e.message}`);
    process.exit(1);
  });
}
