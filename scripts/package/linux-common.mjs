/**
 * Lo común a los paquetes de Linux (.deb y Arch): el `krakenos.env` generado y el árbol de archivos
 * que los dos arman a partir de la carpeta autocontenida (US-284).
 *
 * Todo lo de `/usr` es de root y no escribible por grupo ni otros: lo que root ejecuta no puede ser
 * nada que el usuario del servicio modifique. La propiedad root:root la fija quien empaqueta
 * (`dpkg-deb --root-owner-group`, fakeroot en makepkg); aquí solo se arman rutas y modos.
 */
import { chmod, cp, lstat, mkdir, readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withKindsNone } from './launchers/first-run.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Dónde instala el paquete el helper privilegiado; el .env y la regla de sudoers apuntan aquí. */
export const HELPER_PATH = '/usr/lib/krakenos/libexec/krakenos-helper';

/** Fija `KEY=valor`: reemplaza las líneas existentes (dejando una sola) o la añade si falta. */
function setKey(text, key, value) {
  const re = new RegExp(`^${key}=.*$`, 'gm');
  let seen = false;
  const out = text.replace(re, () => (seen++ ? '\0' : `${key}=${value}`)).replace(/\0\n?/g, '');
  return seen ? out : `${out}${out.endsWith('\n') || out === '' ? '' : '\n'}${key}=${value}\n`;
}

/**
 * Claves que son del PAQUETE y no del usuario: rutas que el paquete instala y modo de despliegue.
 * Si viven en `krakenos.env` (que el usuario edita o borra), basta un cambio para dejar el servicio
 * roto o apuntando a otro helper. Van en `package.env`, que la unidad carga DESPUÉS del del usuario.
 * `HOST` y `PORT` NO están: son elección legítima de quien instala (p. ej. `HOST=127.0.0.1` tras un proxy).
 */
const CLAVES_DEL_PAQUETE = {
  KRAKENOS_DATA_DIR: '/var/lib/krakenos',
  KRAKENOS_DEPLOY_MODE: 'package',
  WG_HELPER_PATH: HELPER_PATH,
  FW_HELPER_PATH: HELPER_PATH,
  TC_HELPER_PATH: HELPER_PATH,
};

/** `package.env`: root:root 0644, sin secretos, con SOLO las claves que fija el paquete. */
export function renderPackageEnv() {
  const lineas = Object.entries(CLAVES_DEL_PAQUETE).map(([k, v]) => `${k}=${v}`);
  return [
    '# Lo fija el paquete de KrakenOS y se vuelve a escribir en cada actualización: no lo edites.',
    '# La unidad lo carga DESPUÉS de /etc/krakenos/krakenos.env, así que estas claves ganan.',
    ...lineas,
    '',
  ].join('\n');
}

/** El `krakenos.env` del usuario: la plantilla con los ocho kinds en none y HOST abierto a la LAN. */
export function renderEnvFile(envExample) {
  let out = withKindsNone(envExample);
  out = setKey(out, 'HOST', '0.0.0.0');
  for (const k of Object.keys(CLAVES_DEL_PAQUETE))
    out = out.replace(new RegExp(`^${k}=.*\\n?`, 'gm'), '');
  return sinComentariosDeLinea(
    `# KRAKENOS_DATA_DIR, KRAKENOS_DEPLOY_MODE y WG_/FW_/TC_HELPER_PATH las fija el paquete en\n` +
      `# /usr/lib/krakenos/package.env (se carga después de este archivo): aquí no tienen efecto.\n${out}`,
  );
}

/** systemd `EnvironmentFile=` deja `valor   # nota` entero como valor: se quita la nota de las líneas activas sin comillas. */
function sinComentariosDeLinea(text) {
  return text.replace(
    /^([A-Za-z_][A-Za-z0-9_]*=)([^"'\n]*)$/gm,
    (_m, k, v) => k + v.replace(/\s+#.*$/, '').trimEnd(),
  );
}

/** Quita escritura a grupo y otros en todo el árbol (los enlaces simbólicos no tienen modo propio). */
async function sinEscrituraAjena(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) await sinEscrituraAjena(p);
    await chmod(p, (await lstat(p)).mode & ~0o022);
  }
}

async function poner(src, dst, mode) {
  await mkdir(dirname(dst), { recursive: true });
  await cp(src, dst);
  await chmod(dst, mode);
}

/**
 * @param {string} pkgDir carpeta autocontenida de US-284 (`bin/`, `node/`, `app/`…)
 * @param {string} rootDir raíz del paquete (`<root>/usr/lib/krakenos`, `<root>/usr/share/krakenos`…)
 */
export async function stageCommonTree(pkgDir, rootDir) {
  const lib = join(rootDir, 'usr', 'lib', 'krakenos');
  const libexec = join(lib, 'libexec');
  const comun = join(REPO, 'packaging', 'linux', 'common');

  await cp(pkgDir, lib, { recursive: true, verbatimSymlinks: true });
  await chmod(lib, 0o755);
  await sinEscrituraAjena(lib);

  await poner(join(comun, 'krakenos-setup'), join(libexec, 'krakenos-setup'), 0o755);
  await poner(join(comun, 'krakenos-open'), join(libexec, 'krakenos-open'), 0o755);
  await poner(
    join(REPO, 'scripts', 'lib', 'krakenos-system.sh'),
    join(libexec, 'lib', 'krakenos-system.sh'),
    0o644,
  );
  // Inactivo: nada lo ejecuta hasta que `krakenos-setup --with-helper` instala la regla de sudoers.
  await poner(
    join(REPO, 'apps', 'agent', 'scripts', 'krakenos-helper.sh'),
    join(rootDir, HELPER_PATH),
    0o755,
  );
  await chmod(libexec, 0o755);
  await chmod(join(libexec, 'lib'), 0o755);

  await poner(
    join(comun, 'krakenos.desktop'),
    join(rootDir, 'usr', 'share', 'applications', 'krakenos.desktop'),
    0o644,
  );
  await poner(
    join(REPO, 'apps', 'web', 'public', 'icon-512.png'),
    join(rootDir, 'usr', 'share', 'icons', 'hicolor', '512x512', 'apps', 'krakenos.png'),
    0o644,
  );
  await poner(
    join(comun, 'krakenos.service'),
    join(rootDir, 'usr', 'lib', 'systemd', 'system', 'krakenos.service'),
    0o644,
  );
  await poner(
    join(comun, 'krakenos.sysusers'),
    join(rootDir, 'usr', 'lib', 'sysusers.d', 'krakenos.conf'),
    0o644,
  );
  await poner(
    join(comun, 'krakenos.tmpfiles'),
    join(rootDir, 'usr', 'lib', 'tmpfiles.d', 'krakenos.conf'),
    0o644,
  );

  // Plantilla de referencia, sin secretos (solo rutas y valores por defecto): 0644. NO va en
  // /etc: el postinst la copia a /etc/krakenos/krakenos.env (0600) solo si no existe, para que
  // dpkg no la trate como conffile (`tls auto` la modifica en toda instalación).
  const env = join(rootDir, 'usr', 'share', 'krakenos', 'krakenos.env');
  await mkdir(dirname(env), { recursive: true });
  await writeFile(
    env,
    renderEnvFile(await readFile(join(pkgDir, 'app', 'agent', '.env.example'), 'utf8')),
  );
  await chmod(env, 0o644);
  await chmod(dirname(env), 0o755);

  // Claves del paquete (root, 0644, sin secretos): la unidad lo carga después del `krakenos.env` del usuario.
  await writeFile(join(lib, 'package.env'), renderPackageEnv());
  await chmod(join(lib, 'package.env'), 0o644);

  const bin = join(rootDir, 'usr', 'bin');
  await mkdir(bin, { recursive: true });
  await symlink('../lib/krakenos/libexec/krakenos-setup', join(bin, 'krakenos-setup'));
  await symlink('../lib/krakenos/libexec/krakenos-open', join(bin, 'krakenos-open'));
}
