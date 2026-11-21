/**
 * `node scripts/package-arch.mjs <carpeta-us284> [--version <v>] [--out out/]`: deja el directorio de
 * `makepkg` (PKGBUILD + krakenos.install + `root.tar` con el árbol ya compuesto) y escribe su ruta en
 * stdout. No corre `makepkg`: va en un Arch (o contenedor) con un usuario que no sea root, que es
 * donde existe y donde pondrá la propiedad root:root (fakeroot). Solo linux-x64.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { archVersion, renderPkgbuild } from './package/arch.mjs';
import { stageCommonTree } from './package/linux-common.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARCH = join(RAIZ, 'packaging', 'linux', 'arch');

function args(argv) {
  const o = { dir: undefined, version: undefined, out: join(RAIZ, 'out') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--version') o.version = argv[++i];
    else if (argv[i] === '--out') o.out = resolve(argv[++i] ?? '');
    else if (!o.dir) o.dir = resolve(argv[i]);
    else throw new Error(`Argumento inesperado: ${argv[i]}`);
  }
  if (!o.dir) throw new Error('uso: package-arch.mjs <carpeta> [--version <v>] [--out <dir>]');
  return o;
}

async function main() {
  const { dir, version, out } = args(process.argv.slice(2));
  const target = /-(linux-x64|linux-arm64|win-x64)$/.exec(basename(dir))?.[1];
  if (!target) throw new Error(`No reconozco la plataforma en el nombre de ${basename(dir)}`);
  if (target !== 'linux-x64')
    throw new Error(`Sin paquete de Arch para ${target} (solo linux-x64)`);
  const v = archVersion(
    version ?? JSON.parse(await readFile(join(RAIZ, 'package.json'), 'utf8')).version,
  );

  const src = join(out, `krakenos-${v}-arch`);
  await rm(src, { recursive: true, force: true });
  const raiz = join(src, 'root');
  await mkdir(raiz, { recursive: true });
  await stageCommonTree(dir, raiz, 'arch-x86_64');

  const lic = join(raiz, 'usr', 'share', 'licenses', 'krakenos');
  await mkdir(lic, { recursive: true });
  await cp(join(RAIZ, 'LICENSE'), join(lic, 'LICENSE'));
  await chmod(join(lic, 'LICENSE'), 0o644);
  // Con una umask estricta los directorios que crea el paquete saldrían 0700; los del sistema son 0755.
  for (const d of [
    '',
    'usr',
    'usr/lib',
    'usr/lib/systemd',
    'usr/lib/systemd/system',
    'usr/lib/sysusers.d',
    'usr/lib/tmpfiles.d',
    'usr/bin',
    'usr/share',
    'usr/share/krakenos',
    'usr/share/licenses',
    'usr/share/licenses/krakenos',
  ])
    await chmod(join(raiz, d), 0o755);

  // makepkg extrae el tar en $srcdir conservando modos y enlaces; el árbol de trabajo ya no hace falta.
  const tar = join(src, 'root.tar');
  const r = spawnSync('tar', ['--sort=name', '-cf', tar, '-C', raiz, 'usr'], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`tar salió con ${r.status}`);
  await rm(raiz, { recursive: true, force: true });
  const sha256 = createHash('sha256')
    .update(await readFile(tar))
    .digest('hex');

  await writeFile(join(src, 'PKGBUILD'), renderPkgbuild({ version: v, pkgrel: 1, sha256 }));
  await cp(join(ARCH, 'krakenos.install'), join(src, 'krakenos.install'));
  await chmod(join(src, 'PKGBUILD'), 0o644);
  await chmod(join(src, 'krakenos.install'), 0o644);
  await chmod(src, 0o755);
  console.log(src);
}

main().catch((e) => {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
});
