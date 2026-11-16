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

/** El `.env` del paquete: la plantilla con los ocho kinds en none, modo package y datos en /var/lib. */
export function renderEnvFile(envExample) {
  let out = withKindsNone(envExample);
  out = setKey(out, 'HOST', '0.0.0.0');
  out = setKey(out, 'KRAKENOS_DATA_DIR', '/var/lib/krakenos');
  out = setKey(out, 'KRAKENOS_DEPLOY_MODE', 'package');
  for (const k of ['WG', 'FW', 'TC']) out = setKey(out, `${k}_HELPER_PATH`, HELPER_PATH);
  return sinComentariosDeLinea(out);
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
 * @param {string} rootDir raíz del paquete (`<root>/usr/lib/krakenos`, `<root>/etc/krakenos`…)
 */
export async function stageCommonTree(pkgDir, rootDir) {
  const lib = join(rootDir, 'usr', 'lib', 'krakenos');
  const libexec = join(lib, 'libexec');
  const comun = join(REPO, 'packaging', 'linux', 'common');

  await cp(pkgDir, lib, { recursive: true, verbatimSymlinks: true });
  await chmod(lib, 0o755);
  await sinEscrituraAjena(lib);

  await poner(join(comun, 'krakenos-setup'), join(libexec, 'krakenos-setup'), 0o755);
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

  // 0640 root:root: lo lee systemd (EnvironmentFile), no el servicio.
  const env = join(rootDir, 'etc', 'krakenos', 'krakenos.env');
  await mkdir(dirname(env), { recursive: true });
  await writeFile(
    env,
    renderEnvFile(await readFile(join(pkgDir, 'app', 'agent', '.env.example'), 'utf8')),
  );
  await chmod(env, 0o640);

  const bin = join(rootDir, 'usr', 'bin');
  await mkdir(bin, { recursive: true });
  await symlink('../lib/krakenos/libexec/krakenos-setup', join(bin, 'krakenos-setup'));
}
