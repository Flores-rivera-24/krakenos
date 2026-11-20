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
export async function prepareDataDir({ dataDir, run, fs }) {
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
  if (!existe) await fs.mkdir(dataDir);

  // Primero la ACL restrictiva y su comprobación; nada se escribe ni se marca antes. `%ProgramData%`
  // deja a cualquier usuario crear dentro de una carpeta recién hecha hasta que se le quita la herencia.
  // El servicio aún no existe y icacls no puede mapear su SID: su permiso va en `grantServiceAccess`,
  // tras instalarlo. `/reset` primero: `/inheritance:r` solo quita lo heredado y una ACE explícita de
  // Users (o de quien sea) en una carpeta previa sobreviviría.
  await aplicarAcl(run, dataDir, BASE);

  // Lo que hubiera dentro NO es de fiar: algo plantado en la ventana entre mkdir e icacls, o en una
  // carpeta previa. Una carpeta nueva tiene que estar vacía; una previa, sin enlaces ni junctions.
  if (!existe) {
    if ((await fs.readdir(dataDir)).length > 0)
      throw new Error(
        `${dataDir} tiene contenido que no puso el instalador (alguien escribió en ella mientras se creaba): revísala, bórrala y vuelve a instalar.`,
      );
  } else {
    await sinEnlaces(fs, dataDir);
    // Lo que ya hay dentro (sin enlaces: comprobado) vuelve a heredar de la raíz ya restringida.
    if ((await fs.readdir(dataDir)).length > 0)
      await ok(run, 'icacls', [join(dataDir, '*'), '/reset', '/T', '/L']);
  }

  // La marca solo tras la ACL verificada y la carpeta limpia: es lo que distingue «mía» de «ajena».
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

  for (const sub of ['keys', 'logs']) await fs.mkdir(join(dataDir, sub), { recursive: true });
  // ca\: solo SYSTEM y Administradores; tls\: el servicio lee pero no escribe.
  await fs.mkdir(join(dataDir, 'ca'), { recursive: true });
  await aplicarAcl(run, join(dataDir, 'ca'), BASE);
  await fs.mkdir(join(dataDir, 'tls'), { recursive: true });
  await aplicarAcl(run, join(dataDir, 'tls'), BASE);
}

/** Con el servicio ya instalado (su SID resuelve): Modificar en los datos y solo lectura en tls\. */
export async function grantServiceAccess({ dataDir, serviceSid, run }) {
  for (const [dir, permiso, derechos] of [
    [dataDir, 'M', /Modify/],
    [join(dataDir, 'tls'), 'RX', /ReadAndExecute/],
  ]) {
    await ok(run, 'icacls', [dir, '/grant:r', `*${serviceSid}:(OI)(CI)${permiso}`]);
    await verificarAcl(run, dir, { ...BASE, [serviceSid]: derechos });
  }
}

const BASE = { 'S-1-5-18': /FullControl/, 'S-1-5-32-544': /FullControl/ };

/** `reset` (quita lo explícito) → `inheritance:r` (quita lo heredado) → SYSTEM y Administradores → verificar. */
async function aplicarAcl(run, dir, esperadas) {
  await ok(run, 'icacls', [dir, '/reset']);
  await ok(run, 'icacls', [dir, '/inheritance:r']);
  await ok(run, 'icacls', [dir, '/grant:r', `${SYSTEM}:(OI)(CI)F`, `${ADMINS}:(OI)(CI)F`]);
  await verificarAcl(run, dir, esperadas);
}

/**
 * Verifica por IDENTIDAD (SIDs, no nombres traducidos): el conjunto de ACE tiene que ser exactamente
 * `esperadas` (SID → derechos), todas Allow y ninguna heredada. Una tercera ACE, aunque sea una sola,
 * (Users, Everyone, un usuario cualquiera) aborta.
 */
async function verificarAcl(run, dir, esperadas) {
  // .NET directo, sin el módulo Get-Acl (no se autocarga bajo el hook) y con los SIDs ya como SID.
  const ps =
    `[System.IO.Directory]::GetAccessControl('${dir.replaceAll("'", "''")}')` +
    `.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { ` +
    `$_.IdentityReference.Value + '|' + $_.FileSystemRights + '|' + $_.AccessControlType + '|' + $_.IsInherited }`;
  const { stdout } = await ok(run, 'powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    ps,
  ]);
  const filas = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.split('|'));
  const vistos = new Set();
  for (const f of filas) {
    const [sid, derechos, tipo, heredada] = f;
    const esperado = esperadas[sid];
    const motivo =
      f.length !== 4
        ? `salida ilegible «${f.join('|')}»`
        : !esperado || vistos.has(sid)
          ? `ACE inesperada de ${sid}`
          : tipo !== 'Allow' || heredada !== 'False' || !esperado.test(derechos)
            ? `ACE de ${sid} distinta de la esperada (${derechos}, ${tipo}, heredada: ${heredada})`
            : '';
    if (motivo) throw new Error(`la ACL de ${dir} no quedó como se esperaba: ${motivo}`);
    vistos.add(sid);
  }
  const falta = Object.keys(esperadas).filter((sid) => !vistos.has(sid));
  if (falta.length > 0)
    throw new Error(`la ACL de ${dir} no quedó como se esperaba: falta ${falta.join(', ')}`);
}

/** Recorre sin seguir enlaces y lanza ante cualquier enlace simbólico o junction. */
async function sinEnlaces(fs, dir) {
  for (const nombre of await fs.readdir(dir)) {
    const ruta = join(dir, nombre);
    const st = await fs.lstat(ruta);
    if (st.isSymbolicLink())
      throw new Error(`${ruta} es un enlace o junction dentro de los datos: se rechaza.`);
    if (st.isDirectory()) await sinEnlaces(fs, ruta);
  }
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
export async function installService({ serviceExe, run, antesDeArrancar }) {
  const q = await run('sc.exe', ['query', SERVICE]);
  if (q.code === NO_EXISTE) await ok(run, serviceExe, ['install']);
  else if (q.code !== 0) throw new Error(`sc.exe query ${SERVICE} salió con ${q.code}`);
  await ok(run, 'sc.exe', ['config', SERVICE, 'obj=', `NT SERVICE\\${SERVICE}`]);
  await ok(run, 'sc.exe', ['sidtype', SERVICE, 'unrestricted']);
  await antesDeArrancar?.();
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

  await prepareDataDir({ dataDir, run, fs });

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
  await installService({
    serviceExe,
    run,
    antesDeArrancar: () =>
      grantServiceAccess({ dataDir, serviceSid: virtualAccountSid(SERVICE), run }),
  });
  await waitHealthy(port, d.healthTimeoutMs ?? 120000, get, { intervalMs: d.intervalMs });
  log(msg(lang, 'listo', port));
  return { port };
}
