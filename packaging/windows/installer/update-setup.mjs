/**
 * Lo que el instalador (elevado) deja preparado para actualizar KrakenOS desde la app: la carpeta
 * `KrakenOS-admin` (solo SYSTEM y Administradores: el servicio no la modifica), una copia de `node.exe`
 * en ella, las tareas programadas de SYSTEM `\KrakenOS\Actualizar` y `\KrakenOS\Recuperar` y el `.exe` del
 * instalador para la vuelta atrás. `run` y `fs` se inyectan, como en `steps.mjs` (de quien importa lo
 * común; la importación circular es segura: nada de aquí lo usa al cargar, solo al llamar).
 * Lo que ejecuta SYSTEM sale de `Program Files` o de `KrakenOS-admin\bin`, nunca de los datos.
 */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  asegurarAcl,
  BASE,
  DUENOS,
  duenoDe,
  hayMarca,
  MARCA_HKLM,
  normRuta,
  ok,
  sinEnlaces,
  verificarAcl,
} from './steps.mjs';

const SUBCARPETAS = ['bin', 'actualizacion', 'instaladores', 'logs', 'estado'];
const SID_SYSTEM = 'S-1-5-18';
const SID_ADMINS = 'S-1-5-32-544';
const NODE_EN_BIN = /^node-[0-9a-f]{12}\.exe$/;
const INSTALADOR = /^KrakenOS-Setup-(.+)-x64\.exe$/;

export const adminDirOf = (programData) => join(programData, 'KrakenOS-admin');

/**
 * Crea (o revalida) `KrakenOS-admin` con la misma política que `prepareDataDir`: una carpeta que no es de un
 * despliegue previo (marca `AdminDir` en HKLM) o cuyo dueño no es de fiar se rechaza con contenido y se
 * rehace vacía; nunca con enlaces dentro. La marca va después de la ACL verificada.
 */
export async function prepareAdminDir({ adminDir, run, fs }) {
  let existe = true;
  try {
    const st = await fs.lstat(adminDir);
    if (st.isSymbolicLink())
      throw new Error(`${adminDir} es un enlace o junction: no se escribe a través de él.`);
    if (!st.isDirectory()) throw new Error(`${adminDir} existe y no es una carpeta.`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    existe = false;
  }
  const marca = existe && (await hayMarca(run, 'AdminDir', adminDir));
  if (existe && (!marca || !DUENOS.includes(await duenoDe(run, adminDir)))) {
    if ((await fs.readdir(adminDir)).length > 0)
      throw new Error(
        `${adminDir} ya existe, no es de un despliegue de KrakenOS (o su dueño no es de fiar) y tiene contenido: muévela o bórrala y vuelve a instalar.`,
      );
    await fs.rmdir(adminDir);
    existe = false;
  }
  if (existe) await sinEnlaces(fs, adminDir);
  // Sin `recursive`: si alguien la recrea entre medias, mkdir falla en vez de adoptarla.
  if (!existe) await fs.mkdir(adminDir);
  const rehecha = await asegurarAcl(run, adminDir, BASE);
  let hijos = [];
  if (!existe) {
    if ((await fs.readdir(adminDir)).length > 0)
      throw new Error(
        `${adminDir} tiene contenido que no puso el instalador: revísala, bórrala y vuelve a instalar.`,
      );
  } else {
    await sinEnlaces(fs, adminDir);
    hijos = await fs.readdir(adminDir);
    for (const h of hijos) {
      await ok(run, 'icacls', [join(adminDir, h), '/reset', '/T', '/L']);
      if (rehecha)
        await ok(run, 'icacls', [join(adminDir, h), '/setowner', '*S-1-5-32-544', '/T', '/L']);
    }
  }
  await ok(run, 'reg.exe', [
    'add',
    MARCA_HKLM,
    '/v',
    'AdminDir',
    '/t',
    'REG_SZ',
    '/d',
    adminDir,
    '/f',
  ]);
  for (const sub of SUBCARPETAS) await fs.mkdir(join(adminDir, sub), { recursive: true });
}

/** El servicio lee `estado\` (el resultado de la última actualización) y no la escribe. Con su SID ya resoluble. */
export async function grantStateAccess({ adminDir, serviceSid, run }) {
  const estado = join(adminDir, 'estado');
  await ok(run, 'icacls', [estado, '/grant:r', `*${serviceSid}:(OI)(CI)RX`]);
  await verificarAcl(run, estado, BASE, { [serviceSid]: /ReadAndExecute/ });
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');

/**
 * Copia `node.exe` del paquete a `bin\node-<sha12>.exe`: el nombre lleva la suma, así una copia en uso por
 * una tarea en marcha nunca se pisa (la nueva convive y la vieja se borra cuando se pueda).
 */
export async function installTaskNode({ installDir, adminDir, fs }) {
  const origen = join(installDir, 'node', 'node.exe');
  const bin = join(adminDir, 'bin');
  const suma = sha256(await fs.readFile(origen));
  const destino = join(bin, `node-${suma.slice(0, 12)}.exe`);
  const actual = await fs.readFile(destino).then(sha256, (e) => {
    if (e?.code === 'ENOENT') return null;
    throw e;
  });
  if (actual !== suma) {
    const tmp = `${destino}.tmp`;
    await fs.rm(tmp, { force: true });
    await fs.copyFile(origen, tmp);
    await fs.rename(tmp, destino);
  }
  for (const n of await fs.readdir(bin))
    if (join(bin, n) !== destino && (NODE_EN_BIN.test(n) || /^node-.*\.tmp$/.test(n)))
      await fs.rm(join(bin, n), { force: true }).catch(() => {}); // en uso por una tarea: se borra en la próxima
  return destino;
}

const xmlEsc = (s) =>
  String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** XML de la tarea: SYSTEM, sin límite de batería, una sola instancia; `recover` la arranca al iniciar Windows. */
export function updateTaskXml({ nodeExe, script, workDir, recover }) {
  const disparador = recover
    ? '<Triggers><BootTrigger><Enabled>true</Enabled><Delay>PT1M</Delay></BootTrigger></Triggers>'
    : '';
  return (
    `<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">` +
    `<RegistrationInfo><Description>KrakenOS: ${recover ? 'recupera una actualización interrumpida' : 'actualiza el programa'}</Description></RegistrationInfo>` +
    disparador +
    `<Principals><Principal id="Author"><UserId>${SID_SYSTEM}</UserId><RunLevel>HighestAvailable</RunLevel></Principal></Principals>` +
    `<Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>` +
    `<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>` +
    `<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>` +
    `<AllowHardTerminate>true</AllowHardTerminate><StartWhenAvailable>false</StartWhenAvailable>` +
    `<AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>true</Hidden>` +
    `<ExecutionTimeLimit>PT2H</ExecutionTimeLimit></Settings>` +
    `<Actions Context="Author"><Exec><Command>${xmlEsc(nodeExe)}</Command>` +
    `<Arguments>${xmlEsc(`"${script}"${recover ? ' --recuperar' : ''}`)}</Arguments>` +
    `<WorkingDirectory>${xmlEsc(workDir)}</WorkingDirectory></Exec></Actions></Task>`
  );
}

/** DACL de la tarea: SYSTEM y Administradores control total; el servicio solo la lee y la arranca (GRGX). */
export const taskSddl = (serviceSid) =>
  `D:P(A;;FA;;;SY)(A;;FA;;;BA)${serviceSid ? `(A;;GRGX;;;${serviceSid})` : ''}`;

const ALIAS = { SY: SID_SYSTEM, BA: SID_ADMINS };
const TOTAL = /^(FA|0x1f01ff)$/i;
const LEER_Y_ARRANCAR = /^(GRGX|FRFX|0x1200a9)$/i;

/**
 * Compara el CONJUNTO de ACE leído de Windows con lo esperado, por SID: SYSTEM y Administradores con control
 * total y, si hay servicio, solo leer y ejecutar. Cualquier otra ACE (Users, Authenticated Users…), una
 * denegación o un derecho de más devuelve el motivo; '' si todo cuadra.
 */
export function checkTaskSddl(sddl, serviceSid) {
  const dacl = /D:[A-Z]*((?:\([^)]*\))*)/.exec(sddl);
  if (!dacl) return `no se pudo leer la DACL de «${sddl}»`;
  const vistas = new Map();
  for (const [, ace] of (dacl[1] ?? '').matchAll(/\(([^)]*)\)/g)) {
    const f = (ace ?? '').split(';');
    const [tipo, , derechos = '', , , quien = ''] = f;
    const sid = (ALIAS[quien.toUpperCase()] ?? quien).toUpperCase();
    if (f.length < 6 || tipo !== 'A') return `ACE ilegible o que no es de permiso: (${ace})`;
    if (vistas.has(sid)) return `ACE repetida de ${sid}`;
    vistas.set(sid, derechos);
  }
  const esperadas = new Map([
    [SID_SYSTEM, TOTAL],
    [SID_ADMINS, TOTAL],
  ]);
  if (serviceSid) esperadas.set(serviceSid.toUpperCase(), LEER_Y_ARRANCAR);
  for (const [sid, derechos] of vistas) {
    const re = esperadas.get(sid);
    if (!re) return `ACE inesperada de ${sid}`;
    if (!re.test(derechos))
      return `ACE de ${sid} con derechos distintos de los esperados (${derechos})`;
  }
  for (const sid of esperadas.keys()) if (!vistas.has(sid)) return `falta la ACE de ${sid}`;
  return '';
}

/**
 * Registra `\KrakenOS\Actualizar` y `\KrakenOS\Recuperar` (COM, sin módulos). XML y SDDL viajan por el entorno,
 * nunca en el texto del script. Tras registrar se lee la DACL que quedó y, si no es la esperada, falla.
 * Va tras `registerRenewalTask`, que crea la carpeta `\KrakenOS`.
 */
export async function registerUpdateTasks({ installDir, adminDir, nodeExe, serviceSid, run }) {
  const script = join(installDir, 'installer', 'actualizar.mjs');
  for (const [nombre, recover] of [
    ['Actualizar', false],
    ['Recuperar', true],
  ]) {
    const sddl = taskSddl(recover ? undefined : serviceSid);
    const ps =
      `$ErrorActionPreference='Stop'; $s = New-Object -ComObject Schedule.Service; $s.Connect(); ` +
      `$f = $s.GetFolder('\\KrakenOS'); ` +
      `$t = $f.RegisterTask('${nombre}', $env:KR_XML, 6, 'SYSTEM', $null, 5, $env:KR_SDDL); ` +
      `'SDDL:' + $t.GetSecurityDescriptor(4)`;
    const { stdout } = await ok(
      run,
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
      {
        env: {
          KR_XML: updateTaskXml({ nodeExe, script, workDir: adminDir, recover }),
          KR_SDDL: sddl,
        },
      },
    );
    const leido = /SDDL:(\S+)/.exec(stdout)?.[1];
    const motivo = leido
      ? checkTaskSddl(leido, recover ? undefined : serviceSid)
      : 'no se pudo leer su DACL';
    if (motivo) throw new Error(`la tarea ${nombre} no quedó como se esperaba: ${motivo}`);
  }
}

/** Orden de versiones `x.y.z[-pre]`; lo que no case va el último. Una versión sin `-pre` gana a la misma con él. */
function clave(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/.exec(v);
  return m
    ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : 0, m[4] ?? '']
    : null;
}
function mayor(a, b) {
  const [x, y] = [clave(a), clave(b)];
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return y[i] - x[i];
  return String(x[4]).localeCompare(String(y[4]));
}

/**
 * Guarda el `.exe` del instalador en `instaladores\` para la vuelta atrás de la próxima actualización. Si
 * `exePath` ya es ese fichero (la vuelta atrás corre desde él), no se copia sobre sí mismo. Poda dejando la
 * versión actual y la más alta de las demás.
 */
export async function keepInstaller({ exePath, version, adminDir, fs }) {
  const dir = join(adminDir, 'instaladores');
  const nombre = `KrakenOS-Setup-${version}-x64.exe`;
  const destino = join(dir, nombre);
  if (normRuta(exePath) !== normRuta(destino)) {
    const tmp = `${destino}.tmp`;
    await fs.rm(tmp, { force: true });
    await fs.copyFile(exePath, tmp);
    await fs.rename(tmp, destino);
  }
  const otras = (await fs.readdir(dir))
    .map((n) => [n, INSTALADOR.exec(n)?.[1]])
    .filter(([n, v]) => v !== undefined && n !== nombre)
    .map(([n, v]) => ({ n, v }))
    .sort((a, b) => mayor(a.v, b.v));
  for (const { n } of otras.slice(1)) await fs.rm(join(dir, n), { force: true }).catch(() => {});
}
