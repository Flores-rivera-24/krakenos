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
 *   propia (`detached`) y `scripts/package/ctrlc.ps1` se la manda desde fuera. `taskkill /F` sobre
 *   node no vale: mata sin avisar y deja el WAL.
 */
/* global AbortSignal */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Arranca el lanzador; devuelve lo necesario para sondearlo y pararlo. */
function arrancar(pkg, env) {
  const lanzador = WIN ? join(pkg, 'krakenos.cmd') : join(pkg, 'bin', 'krakenos');
  const hijo = WIN
    ? spawn('cmd.exe', ['/d', '/c', lanzador], { env, detached: true, windowsHide: true })
    : spawn(lanzador, [], { env });
  const st = { salida: '', cerro: false, nodePid: WIN ? null : hijo.pid };
  const recoge = (d) => {
    st.salida += d.toString();
    // pino escribe `"pid":N` en cada línea; en Windows el pid del spawn es el de cmd.exe.
    if (WIN && st.nodePid === null) {
      const m = /"pid":(\d+)/.exec(st.salida);
      if (m) st.nodePid = Number(m[1]);
    }
  };
  hijo.stdout.on('data', recoge);
  hijo.stderr.on('data', recoge);
  hijo.on('close', () => {
    st.cerro = true;
  });
  return { hijo, st };
}

async function sondear(url, st) {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) }).catch(() => null);
  if (!res && st.cerro) throw new Error(`el agente salió antes de responder:\n${st.salida}`);
  return res;
}

async function parar({ hijo, st }) {
  if (WIN) {
    if (st.nodePid === null) throw new Error(`no se vio el pid de node en el log:\n${st.salida}`);
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
      ],
      { encoding: 'utf8' },
    );
    if (ps.status !== 0)
      throw new Error(`ctrlc.ps1 falló (${ps.status}): ${ps.stdout}${ps.stderr}`);
    await esperarA(
      () => !vivo(st.nodePid),
      ESPERA_PARADA_MS,
      `node (pid ${st.nodePid}) no salió tras Ctrl+C`,
    );
    // El cmd envoltorio se queda en «Terminate batch job (Y/N)?»; node ya salió, así que /F es seguro.
    spawnSync('taskkill', ['/PID', String(hijo.pid), '/T', '/F']);
  } else {
    hijo.kill('SIGTERM');
    await esperarA(() => st.cerro, ESPERA_PARADA_MS, 'el agente no salió tras SIGTERM');
  }
}

/** Limpieza de último recurso si algo falló antes de parar con normalidad. */
function matar({ hijo, st }) {
  if (st.cerro) return;
  if (WIN) {
    if (st.nodePid !== null && vivo(st.nodePid))
      spawnSync('taskkill', ['/PID', String(st.nodePid), '/T', '/F']);
    spawnSync('taskkill', ['/PID', String(hijo.pid), '/T', '/F']);
  } else {
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

    renameSync(pkg, movida);
    console.log(`==> carpeta renombrada a ${movida}`);
    try {
      await ronda('segundo arranque (carpeta movida)', movida, env, port);
    } finally {
      renameSync(movida, pkg);
      console.log(`==> carpeta devuelta a ${pkg}`);
    }

    const restos = findWalLeftovers(datos);
    if (restos.length > 0)
      throw new Error(`quedaron ficheros WAL tras parar: ${restos.join(', ')}`);
    console.log('==> findWalLeftovers: []');
    console.log('Smoke OK');
  } finally {
    rmSync(datos, { recursive: true, force: true });
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(`Smoke FALLÓ: ${e.message}`);
    process.exit(1);
  });
}
