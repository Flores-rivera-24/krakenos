/**
 * Pasos del instalador de Windows (datos con ACL, primer arranque, servicio). Corre con el Node
 * empaquetado y ELEVADO (lo lanza el hook POSTINSTALL), así que no hay nada que el servicio pueda
 * modificar en lo que ejecuta: todo sale de `Program Files`. `run` y `fs` se inyectan para probar
 * en Vitest las líneas de comando exactas; en `windows-latest` se ejecutan de verdad.
 * Nunca se lee ni se escribe el token de setup: lo crea el agente y no pasa por aquí.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { msg } from './mensajes.mjs';

export const SERVICE = 'KrakenOS';
export const MARCA_HKLM = 'HKLM\\SOFTWARE\\KrakenOS';
const SYSTEM = '*S-1-5-18';
const ADMINS = '*S-1-5-32-544';
const NO_EXISTE = 1060; // ERROR_SERVICE_DOES_NOT_EXIST

/** SID de la cuenta virtual `NT SERVICE\<nombre>`: SHA-1 del nombre en mayúsculas, UTF-16LE, 5 enteros LE. */
export function virtualAccountSid(nombre) {
  const h = createHash('sha1').update(Buffer.from(nombre.toUpperCase(), 'utf16le')).digest();
  const partes = Array.from({ length: 5 }, (_, i) => h.readUInt32LE(i * 4));
  return `S-1-5-80-${partes.join('-')}`;
}

/** Código de estado de `sc query` (1 STOPPED, 4 RUNNING): el texto va traducido, el número no. */
const estado = (stdout) => Number(/:\s*([1-7])\s+\S+/.exec(stdout)?.[1] ?? 0);

async function ok(run, cmd, args) {
  const r = await run(cmd, args);
  if (r.code !== 0) {
    const cola = r.stdout.trim().slice(-300);
    throw new Error(`${cmd} ${args.join(' ')} salió con ${r.code}${cola ? `: ${cola}` : ''}`);
  }
  return r;
}

async function hayMarca(run, dataDir) {
  const r = await run('reg.exe', ['query', MARCA_HKLM, '/v', 'DataDir']);
  return r.code === 0 && r.stdout.toLowerCase().includes(dataDir.toLowerCase());
}

/**
 * Crea (o revalida) la carpeta de datos con ACL por SID y sin `/T`, ANTES de crear claves.
 * `C:\ProgramData` deja crear carpetas a cualquier usuario: una que ya exista sin ser de un despliegue
 * previo (marca en HKLM, solo escribible por admin) se rechaza si tiene contenido, y si está vacía se
 * rehace, porque quien la creó sería su dueño y podría devolverse permisos con WRITE_DAC.
 */
export async function prepareDataDir({ dataDir, serviceSid, run, fs }) {
  let existe = true;
  try {
    const st = await fs.lstat(dataDir);
    if (st.isSymbolicLink())
      throw new Error(`${dataDir} es un enlace o junction: no se escriben claves a través de él.`);
    if (!st.isDirectory()) throw new Error(`${dataDir} existe y no es una carpeta.`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    existe = false;
  }
  if (existe && !(await hayMarca(run, dataDir))) {
    if ((await fs.readdir(dataDir)).length > 0)
      throw new Error(
        `${dataDir} ya existe, no es de un despliegue de KrakenOS y tiene contenido: muévela o bórrala y vuelve a instalar.`,
      );
    await fs.rmdir(dataDir);
    existe = false;
  }
  // Sin `recursive`: si alguien la recrea entre medias, mkdir falla en vez de adoptarla.
  if (!existe) {
    await fs.mkdir(dataDir);
    // La marca va ya: si algo falla entre la ACL y el final, el reintento reconoce la carpeta como
    // suya (con la ACL a medias ni el administrador podría listarla para decidirlo).
    await ok(run, 'reg.exe', [
      'add',
      MARCA_HKLM,
      '/v',
      'DataDir',
      '/t',
      'REG_SZ',
      '/d',
      dataDir,
      '/f',
    ]);
  }

  const servicio = `*${serviceSid}`;
  await ok(run, 'icacls', [dataDir, '/inheritance:r']);
  await ok(run, 'icacls', [
    dataDir,
    '/grant:r',
    `${SYSTEM}:(OI)(CI)F`,
    `${ADMINS}:(OI)(CI)F`,
    `${servicio}:(OI)(CI)M`,
  ]);
  for (const sub of ['keys', 'logs']) await fs.mkdir(join(dataDir, sub), { recursive: true });
  // ca\: solo SYSTEM y Administradores; tls\: el servicio lee pero no escribe.
  const aparte = [
    ['ca', []],
    ['tls', [`${servicio}:(OI)(CI)RX`]],
  ];
  for (const [nombre, extra] of aparte) {
    const dir = join(dataDir, nombre);
    await fs.mkdir(dir, { recursive: true });
    await ok(run, 'icacls', [dir, '/inheritance:r']);
    await ok(run, 'icacls', [
      dir,
      '/grant:r',
      `${SYSTEM}:(OI)(CI)F`,
      `${ADMINS}:(OI)(CI)F`,
      ...extra,
    ]);
  }
  await ok(run, 'reg.exe', [
    'add',
    MARCA_HKLM,
    '/v',
    'DataDir',
    '/t',
    'REG_SZ',
    '/d',
    dataDir,
    '/f',
  ]);
}

/** El preferido si está libre; si no, el siguiente libre (hasta 50 más). */
export async function pickPort(preferred, isFree) {
  const tope = Math.min(preferred + 50, 65535);
  for (let p = preferred; p <= tope; p++) if (await isFree(p)) return p;
  throw new Error(`no hay un puerto libre entre el ${preferred} y el ${tope}`);
}

/** Cambia el `PORT` del servicio en el XML de WinSW; lanza si no lo encuentra (no se finge). */
export function withXmlPort(xml, port) {
  const re = /(<env name="PORT" value=")\d+("\s*\/>)/;
  if (!re.test(xml)) throw new Error('el XML del servicio no trae la variable PORT');
  return xml.replace(re, `$1${port}$2`);
}

/** `install` → cuenta virtual → `sidtype` → `start`. Si el servicio ya existe (actualizar) no lo reinstala. */
export async function installService({ serviceExe, run }) {
  const q = await run('sc.exe', ['query', SERVICE]);
  if (q.code === NO_EXISTE) await ok(run, serviceExe, ['install']);
  else if (q.code !== 0) throw new Error(`sc.exe query ${SERVICE} salió con ${q.code}`);
  await ok(run, 'sc.exe', ['config', SERVICE, 'obj=', `NT SERVICE\\${SERVICE}`]);
  await ok(run, 'sc.exe', ['sidtype', SERVICE, 'unrestricted']);
  if (estado(q.stdout) !== 4) await ok(run, serviceExe, ['start']);
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Para el servicio y espera a `STOPPED`; no hace nada si no existe. */
export async function stopService({ serviceExe, run, sleep = dormir, timeoutMs = 60000 }) {
  const q = await run('sc.exe', ['query', SERVICE]);
  if (q.code === NO_EXISTE || estado(q.stdout) === 1) return;
  await run(serviceExe, ['stop']); // si ya estaba parándose devuelve error: manda el sondeo
  const limite = Date.now() + timeoutMs;
  for (;;) {
    const s = await run('sc.exe', ['query', SERVICE]);
    if (s.code === NO_EXISTE || estado(s.stdout) === 1) return;
    if (Date.now() >= limite) throw new Error(`el servicio ${SERVICE} no se detuvo a tiempo`);
    await sleep(500);
  }
}

export async function uninstallService({ serviceExe, run, sleep, timeoutMs }) {
  await stopService({ serviceExe, run, sleep, timeoutMs });
  const q = await run('sc.exe', ['query', SERVICE]);
  if (q.code !== NO_EXISTE) await ok(run, serviceExe, ['uninstall']);
}

/** Espera un 200 de `/health/ready`; un fallo de conexión cuenta como «todavía no». */
export async function waitHealthy(port, timeoutMs, get, { intervalMs = 1000 } = {}) {
  const url = `http://127.0.0.1:${port}/health/ready`;
  const limite = Date.now() + timeoutMs;
  for (;;) {
    try {
      if ((await get(url)) === 200) return;
    } catch {
      /* aún no escucha */
    }
    if (Date.now() >= limite)
      throw new Error(
        `el servicio no respondió en el puerto ${port} en ${Math.round(timeoutMs / 1000)} s; mira %ProgramData%\\KrakenOS\\logs`,
      );
    await dormir(intervalMs);
  }
}

/** Instalación completa. Cualquier fallo se propaga: el CLI sale con código distinto de 0. */
export async function runInstall(d) {
  const { installDir, dataDir, run, fs, isFree, get, setKey, log } = d;
  const lang = d.lang ?? 'es';
  const serviceExe = join(installDir, 'service', 'KrakenOS-service.exe');
  const xmlPath = join(installDir, 'service', 'KrakenOS-service.xml');
  const envPath = join(dataDir, '.env');

  await prepareDataDir({ dataDir, serviceSid: virtualAccountSid(SERVICE), run, fs });

  // Al actualizar se parte del puerto que ya tenía el .env, para no cambiarlo sin motivo.
  const previo = await fs.readFile(envPath, 'utf8').catch(() => '');
  const m = /^PORT=(\d{1,5})\s*$/m.exec(previo);
  const preferido = m ? Number(m[1]) : 3001;

  await d.ensureEnv(dataDir);
  const port = await pickPort(preferido, isFree);
  if (port !== preferido) log(msg(lang, 'puertoOcupado', preferido, port));
  const env = setKey(
    setKey(await fs.readFile(envPath, 'utf8'), 'HOST', '0.0.0.0'),
    'PORT',
    String(port),
  );
  await fs.writeFile(envPath, env);
  await fs.writeFile(xmlPath, withXmlPort(await fs.readFile(xmlPath, 'utf8'), port));

  await d.ensureKeys(dataDir);
  await installService({ serviceExe, run });
  await waitHealthy(port, d.healthTimeoutMs ?? 120000, get, { intervalMs: d.intervalMs });
  log(msg(lang, 'listo', port));
  return { port };
}
