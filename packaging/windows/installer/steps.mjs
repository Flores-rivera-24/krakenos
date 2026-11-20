/**
 * Pasos del instalador de Windows (datos con ACL, primer arranque, servicio). Corre con el Node
 * empaquetado y ELEVADO (lo lanza el hook POSTINSTALL), así que no hay nada que el servicio pueda
 * modificar en lo que ejecuta: todo sale de `Program Files`. `run` y `fs` se inyectan para probar
 * en Vitest las líneas de comando exactas; en `windows-latest` se ejecutan de verdad.
 * Nunca se lee ni se escribe el token de setup: lo crea el agente y no pasa por aquí.
 */
import { createHash, createPrivateKey, createPublicKey, X509Certificate } from 'node:crypto';
import { join } from 'node:path';
import { msg } from './mensajes.mjs';

export const SERVICE = 'KrakenOS';
export const MARCA_HKLM = 'HKLM\\SOFTWARE\\KrakenOS';
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

async function ok(run, cmd, args, opciones) {
  const r = await run(cmd, args, opciones);
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
 * Crea (o revalida) la carpeta de datos con ACL por SID (raíz sin `/T`), ANTES de crear claves.
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
  // Con la carpeta ya existente (servicio parado por PREINSTALL), los enlaces se buscan ANTES de tocar
  // ninguna ACL: el servicio puede crear junctions y el cambio de la raíz se propaga hacia abajo.
  if (existe) await sinEnlaces(fs, dataDir);
  // Sin `recursive`: si alguien la recrea entre medias, mkdir falla en vez de adoptarla.
  if (!existe) await fs.mkdir(dataDir);

  // Primero la ACL restrictiva y su comprobación; nada se escribe ni se marca antes. `%ProgramData%`
  // deja a cualquier usuario crear dentro de una carpeta recién hecha hasta que se le quita la herencia.
  // El servicio aún no existe en una instalación nueva y icacls no puede mapear su SID: su permiso va
  // en `grantServiceAccess`, tras instalarlo (en una actualización ya lo tiene y se acepta).
  const sidServicio = virtualAccountSid(SERVICE);
  const rehecha = await asegurarAcl(run, dataDir, BASE, { [sidServicio]: /Modify/ });

  // Lo que hubiera dentro NO es de fiar: algo plantado en la ventana entre mkdir y la ACL, o en una
  // carpeta previa. Una carpeta nueva tiene que estar vacía; una previa, sin enlaces ni junctions.
  let hijos = [];
  if (!existe) {
    if ((await fs.readdir(dataDir)).length > 0)
      throw new Error(
        `${dataDir} tiene contenido que no puso el instalador (alguien escribió en ella mientras se creaba): revísala, bórrala y vuelve a instalar.`,
      );
  } else {
    await sinEnlaces(fs, dataDir);
    // Lo que ya hay dentro (sin enlaces: comprobado) vuelve a heredar de la raíz ya restringida, UNO A
    // UNO y sin `ca\` ni `tls\`: con un `datos\*` esas dos heredarían de la raíz (donde el servicio
    // modifica) hasta que se les aplicara su propia ACL. Si la raíz hubo que rehacerla (otro la tocó o
    // era ajena), también se le quita el dueño a lo de dentro.
    hijos = await fs.readdir(dataDir);
    for (const h of hijos.filter((n) => n !== 'ca' && n !== 'tls')) {
      await ok(run, 'icacls', [join(dataDir, h), '/reset', '/T', '/L']);
      if (rehecha) await ok(run, 'icacls', [join(dataDir, h), '/setowner', ADMINS, '/T', '/L']);
    }
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
  // ca\: solo SYSTEM y Administradores; tls\: el servicio lee pero no escribe. Su ACL se fija de una vez
  // (protegida) y SOLO después lo que tuvieran dentro hereda de ellas.
  let caExpuesta = false;
  for (const [sub, opcionales] of [
    ['ca', {}],
    ['tls', { [sidServicio]: /ReadAndExecute/ }],
  ]) {
    const dir = join(dataDir, sub);
    const tenia = hijos.includes(sub) && (await fs.readdir(dir)).length > 0;
    await fs.mkdir(dir, { recursive: true });
    const rehechaSub = await asegurarAcl(run, dir, BASE, opcionales);
    // Con contenido y una ACL que estaba abierta, la clave de la CA pudo leerse (o el certificado cambiarse).
    if (tenia && rehechaSub) caExpuesta = true;
    if (tenia) {
      await ok(run, 'icacls', [join(dir, '*'), '/reset', '/T', '/L']);
      if (rehechaSub) await ok(run, 'icacls', [join(dir, '*'), '/setowner', ADMINS, '/T', '/L']);
    }
  }
  return { caExpuesta };
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

const DUENOS = ['S-1-5-18', 'S-1-5-32-544'];

/**
 * Deja `dir` como `esperadas` sin que la DACL pase NUNCA por un estado heredado o vacío: si ya está
 * bien (por SID, incluido el dueño) no la toca; si no, la sustituye de una vez (`SetAccessRuleProtection`
 * + SYSTEM y Administradores) y fija el dueño en Administradores. Un `/reset` abriría la raíz a lo que
 * herede de `C:\ProgramData` (Users) hasta quitarle la herencia, y con la DACL vacía en medio Windows
 * no propaga a los hijos que creó el servicio. `opcionales` (el servicio, en una actualización) puede
 * estar o no, pero si está tiene que llevar esos derechos. Devuelve si hubo que rehacerla.
 */
async function asegurarAcl(run, dir, esperadas, opcionales = {}) {
  if (!(await desviacion(run, dir, esperadas, opcionales))) return false;
  const q = (v) => v.replaceAll("'", "''");
  const regla = (sid) =>
    `$s.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(` +
    `(New-Object System.Security.Principal.SecurityIdentifier('${sid}')),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))); `;
  const ps =
    `$s = New-Object System.Security.AccessControl.DirectorySecurity; $s.SetAccessRuleProtection($true, $false); ` +
    Object.keys(esperadas).map(regla).join('') +
    `[System.IO.Directory]::SetAccessControl('${q(dir)}', $s)`;
  await ok(run, 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps]);
  await ok(run, 'icacls', [dir, '/setowner', ADMINS]);
  await verificarAcl(run, dir, esperadas, opcionales);
  return true;
}

async function verificarAcl(run, dir, esperadas, opcionales = {}) {
  const motivo = await desviacion(run, dir, esperadas, opcionales);
  if (motivo) throw new Error(`la ACL de ${dir} no quedó como se esperaba: ${motivo}`);
}

/**
 * Compara por IDENTIDAD (SIDs, no nombres traducidos): el dueño es SYSTEM o Administradores y el conjunto
 * de ACE tiene que ser exactamente `esperadas` (SID → derechos) más, si están, `opcionales`; todas Allow
 * y ninguna heredada. Una tercera ACE, aunque sea una sola, devuelve el motivo; '' si todo cuadra.
 */
async function desviacion(run, dir, esperadas, opcionales) {
  // .NET directo, sin el módulo Get-Acl (no se autocarga bajo el hook) y con los SIDs ya como SID.
  const d = dir.replaceAll("'", "''");
  const ps =
    `$a = [System.IO.Directory]::GetAccessControl('${d}'); ` +
    `'OWNER:' + $a.GetOwner([System.Security.Principal.SecurityIdentifier]).Value; ` +
    `$a.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { ` +
    `$_.IdentityReference.Value + '|' + $_.FileSystemRights + '|' + $_.AccessControlType + '|' + $_.IsInherited }`;
  const { stdout } = await ok(run, 'powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    ps,
  ]);
  const lineas = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const dueno = lineas.find((l) => l.startsWith('OWNER:'))?.slice(6);
  if (!dueno || !DUENOS.includes(dueno)) return `dueño inesperado «${dueno ?? 'ilegible'}»`;
  const permitidas = { ...esperadas, ...opcionales };
  const vistos = new Set();
  for (const f of lineas.filter((l) => !l.startsWith('OWNER:')).map((l) => l.split('|'))) {
    const [sid, derechos, tipo, heredada] = f;
    const esperado = permitidas[sid];
    const motivo =
      f.length !== 4
        ? `salida ilegible «${f.join('|')}»`
        : !esperado || vistos.has(sid)
          ? `ACE inesperada de ${sid}`
          : tipo !== 'Allow' || heredada !== 'False' || !esperado.test(derechos)
            ? `ACE de ${sid} distinta de la esperada (${derechos}, ${tipo}, heredada: ${heredada})`
            : '';
    if (motivo) return motivo;
    vistos.add(sid);
  }
  const falta = Object.keys(esperadas).filter((sid) => !vistos.has(sid));
  return falta.length > 0 ? `falta ${falta.join(', ')}` : '';
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
export async function waitHealthy(port, timeoutMs, get, { intervalMs = 1000, https = false } = {}) {
  const url = `${https ? 'https' : 'http'}://127.0.0.1:${port}/health/ready`;
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

/** Nombre corto del equipo, saneado como `local_hostname` de Linux y `crypto/local-ca.ts`. */
export function localHostname(raw) {
  const h = String(raw ?? '')
    .split('.')[0]
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
  return h || 'krakenos';
}

/** `https://<host>[:<puerto>]`; el 443 es el de https y no se escribe (como `https_origin` de Linux). */
const httpsOrigin = (host, port) => (port === 443 ? `https://${host}` : `https://${host}:${port}`);

/**
 * HTTPS con la CA local, como `setup_tls_local` de Linux. Una CA que ya existe en `ca\` NO se recrea
 * (`local-ca.js` la conserva): reinstalar con datos conservados reimporta la MISMA y los celulares que
 * ya la confían siguen confiando. Si falla, la instalación falla: sin HTTPS no hay PWA, push ni passkeys.
 * Antes de que `local-ca.js` escriba la clave de la CA, `ca\` se verifica por SID exacto (solo SYSTEM y
 * Administradores): jamás una clave en una carpeta que el servicio pueda modificar.
 */
export async function setupTls({
  installDir,
  dataDir,
  hostname,
  port,
  run,
  fs,
  setKey,
  rotarCa = false,
}) {
  const ca = join(dataDir, 'ca');
  const tls = join(dataDir, 'tls');
  const envPath = join(dataDir, '.env');
  await verificarAcl(run, ca, BASE);
  await verificarAcl(run, tls, BASE, { [virtualAccountSid(SERVICE)]: /ReadAndExecute/ });

  // Una CA cuya carpeta estaba abierta no se adopta: se quita de la confianza de la máquina (por el
  // thumbprint de HKLM, que el servicio no escribe) y se borra para que `local-ca.js` genere otra.
  if (rotarCa) {
    const q = await run('reg.exe', ['query', MARCA_HKLM, '/v', 'CaThumbprint']);
    const viejo = /CaThumbprint\s+REG_SZ\s+([0-9A-Fa-f]{40})/.exec(q.stdout)?.[1];
    if (viejo) await run('certutil', ['-delstore', 'Root', viejo]); // si ya no estaba, da igual
    for (const f of [
      join(ca, 'krakenos-ca-key.pem'),
      join(ca, 'krakenos-ca.pem'),
      join(tls, 'krakenos-ca.pem'),
      join(tls, 'agent-key.pem'),
      join(tls, 'agent-cert.pem'),
    ])
      await fs.rm(f, { force: true });
  }

  await ok(
    run,
    join(installDir, 'node', 'node.exe'),
    [join(installDir, 'app', 'agent', 'dist', 'local-ca.js')],
    {
      env: { KRAKENOS_HOSTNAME: hostname, KRAKENOS_CERTS_DIR: tls, KRAKENOS_KEYS_DIR: ca },
    },
  );

  // `local-ca.js` deja el certificado público en tls\; se importa una copia de ca\ (la carpeta más cerrada).
  const caPem = join(tls, 'krakenos-ca.pem');
  const pem = await fs.readFile(caPem, 'utf8').catch(() => {
    throw new Error(`local-ca.js no dejó ${caPem}`);
  });
  const caCopia = join(ca, 'krakenos-ca.pem');
  // El certificado que se confía tiene que ser el de la clave guardada en ca\ (carpeta cerrada): lo que
  // haya en tls\ por sí solo no prueba nada.
  const cert = new X509Certificate(pem);
  const claveCa = await fs.readFile(join(ca, 'krakenos-ca-key.pem'), 'utf8').catch(() => '');
  const spki = (k) => k.export({ type: 'spki', format: 'der' });
  let casan = false;
  try {
    casan = spki(cert.publicKey).equals(spki(createPublicKey(createPrivateKey(claveCa))));
  } catch {
    /* clave ilegible: no casa */
  }
  if (!casan)
    throw new Error(
      `${caPem} no corresponde a la clave de ${join(ca, 'krakenos-ca-key.pem')}: no se confía. Borra ambos para regenerar la CA.`,
    );
  await fs.writeFile(caCopia, pem);
  const thumbprint = cert.fingerprint.replaceAll(':', '');
  await ok(run, 'certutil', ['-addstore', '-f', 'Root', caCopia]);
  // En HKLM y no en un fichero de datos: el desinstalador, elevado, no debe fiarse de algo que escribe el servicio.
  await ok(run, 'reg.exe', [
    'add',
    MARCA_HKLM,
    '/v',
    'CaThumbprint',
    '/t',
    'REG_SZ',
    '/d',
    thumbprint,
    '/f',
  ]);

  // La renovación (SYSTEM) lee esto, no el `.env`.
  await fs.writeFile(
    join(ca, 'tls.json'),
    `${JSON.stringify({ hostname, certsDir: tls, keysDir: ca })}\n`,
  );

  const origin = httpsOrigin(`${hostname}.local`, port);
  let env = await fs.readFile(envPath, 'utf8').catch(() => '');
  for (const [k, v] of [
    ['HTTPS_ENABLED', 'true'],
    ['TLS_CERT_PATH', join(tls, 'agent-cert.pem')],
    ['TLS_KEY_PATH', join(tls, 'agent-key.pem')],
    ['TLS_CA_CERT_PATH', caPem],
    ['WEB_ORIGIN', origin],
    ['WEBAUTHN_RP_ID', `${hostname}.local`],
    ['WEBAUTHN_ORIGIN', origin],
  ])
    env = setKey(env, k, v);
  await fs.writeFile(envPath, env);
  return { origin, thumbprint, rotada: rotarCa };
}

/**
 * `window.json` (`{ origin }`): lo único de los datos que lee `Users` (la ventana, sin elevar). Sin
 * herencia, para que el servicio tampoco pueda reescribirlo y redirigir la ventana. Si el servicio plantó
 * un enlace con ese nombre, se borra y se crea con `wx`: el instalador elevado no escribe a través de él.
 */
export async function writeWindowJson({ dataDir, origin, run, fs }) {
  const f = join(dataDir, 'window.json');
  // Se prepara en ca\ (cerrada al servicio) con su ACL ya puesta y se renombra a su sitio: la entrada del
  // servicio se sustituye sin escribir a través de ella y el fichero nunca hereda el Modificar de la raíz.
  const t = join(dataDir, 'ca', 'window.json.tmp');
  await fs.rm(t, { force: true });
  await fs.writeFile(t, `${JSON.stringify({ origin })}\n`, { flag: 'wx' });
  await ok(run, 'icacls', [
    t,
    '/grant:r',
    '*S-1-5-18:(F)',
    `${ADMINS}:(F)`,
    '*S-1-5-32-545:(R)',
    '/inheritance:r',
    '/L',
  ]);
  await fs.rename(t, f);
  const st = await fs.lstat(f);
  if (st.isSymbolicLink() || st.isDirectory())
    throw new Error(`${f} no es un fichero normal tras crearlo: se rechaza.`);
}

/** Tarea semanal como SYSTEM: el `.mjs` sale de `Program Files`; la carpeta de datos solo viaja de argumento. */
export async function registerRenewalTask({ installDir, dataDir, run }) {
  const tr = `"${join(installDir, 'node', 'node.exe')}" "${join(installDir, 'installer', 'renew-tls.mjs')}" "${dataDir}"`;
  await ok(run, 'schtasks', [
    '/Create',
    '/TN',
    '\\KrakenOS\\RenovarTLS',
    '/SC',
    'WEEKLY',
    '/ST',
    '03:30',
    '/RU',
    'SYSTEM',
    '/TR',
    tr,
    '/F',
  ]);
}

/** Instalación completa. Cualquier fallo se propaga: el CLI sale con código distinto de 0. */
export async function runInstall(d) {
  const { installDir, dataDir, run, fs, isFree, get, setKey, log } = d;
  const lang = d.lang ?? 'es';
  const serviceExe = join(installDir, 'service', 'KrakenOS-service.exe');
  const xmlPath = join(installDir, 'service', 'KrakenOS-service.xml');
  const envPath = join(dataDir, '.env');

  const { caExpuesta } = await prepareDataDir({ dataDir, run, fs });

  // Al actualizar se parte del puerto que ya tenía el .env, para no cambiarlo sin motivo.
  const previo = await fs.readFile(envPath, 'utf8').catch(() => '');
  const m = /^PORT=(\d{1,5})\s*$/m.exec(previo);
  const preferido = m ? Number(m[1]) : 3001;

  // `HOST` y `PORT` son elección de quien instala: en una actualización el .env no se toca, salvo el
  // puerto si el que tenía está ocupado (entonces se pasa al siguiente libre y se dice).
  const creado = await d.ensureEnv(dataDir);
  const port = await pickPort(preferido, isFree);
  if (port !== preferido) log(msg(lang, 'puertoOcupado', preferido, port));
  if (creado || port !== preferido) {
    let env = await fs.readFile(envPath, 'utf8');
    if (creado) env = setKey(env, 'HOST', '0.0.0.0');
    await fs.writeFile(envPath, setKey(env, 'PORT', String(port)));
  }
  await fs.writeFile(xmlPath, withXmlPort(await fs.readFile(xmlPath, 'utf8'), port));

  await d.ensureKeys(dataDir);
  // HTTPS antes de arrancar: el agente lee el certificado al iniciar. El puerto es el ya elegido.
  const { origin, rotada } = await setupTls({
    rotarCa: caExpuesta,
    installDir,
    dataDir,
    hostname: localHostname(d.hostname),
    port,
    run,
    fs,
    setKey,
  });
  await writeWindowJson({ dataDir, origin, run, fs });
  await registerRenewalTask({ installDir, dataDir, run });
  await installService({
    serviceExe,
    run,
    antesDeArrancar: () =>
      grantServiceAccess({ dataDir, serviceSid: virtualAccountSid(SERVICE), run }),
  });
  await waitHealthy(port, d.healthTimeoutMs ?? 120000, get, {
    intervalMs: d.intervalMs,
    https: true,
  });
  log(msg(lang, 'listo', port));
  log(msg(lang, 'tlsListo', origin));
  if (rotada) log(msg(lang, 'caRotada'));
  return { port };
}
