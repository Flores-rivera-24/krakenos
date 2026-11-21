/**
 * `node scripts/package-deb.mjs <carpeta-us284> [--version <v>] [--out out/]`: arma el `.deb` a
 * partir de la carpeta autocontenida de `pnpm package` y escribe su ruta en stdout.
 * `--version` (semver) existe para la prueba de actualización del ciclo de vida.
 */
import { spawnSync } from 'node:child_process';
import { chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { debArch, debFileName, debVersion, renderControl } from './package/deb.mjs';
import { stageCommonTree } from './package/linux-common.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEB = join(RAIZ, 'packaging', 'linux', 'deb');

function args(argv) {
  const o = { dir: undefined, version: undefined, out: join(RAIZ, 'out') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--version') o.version = argv[++i];
    else if (argv[i] === '--out') o.out = resolve(argv[++i] ?? '');
    else if (!o.dir) o.dir = resolve(argv[i]);
    else throw new Error(`Argumento inesperado: ${argv[i]}`);
  }
  if (!o.dir) throw new Error('uso: package-deb.mjs <carpeta> [--version <v>] [--out <dir>]');
  return o;
}

function ejecutar(cmd, a) {
  const r = spawnSync(cmd, a, { stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${a.join(' ')} salió con ${r.status}`);
  return r.stdout;
}

async function main() {
  const { dir, version, out } = args(process.argv.slice(2));
  const target = /-(linux-x64|linux-arm64|win-x64)$/.exec(basename(dir))?.[1];
  if (!target) throw new Error(`No reconozco la plataforma en el nombre de ${basename(dir)}`);
  const arch = debArch(target);
  const v = debVersion(
    version ?? JSON.parse(await readFile(join(RAIZ, 'package.json'), 'utf8')).version,
  );
  if (!/^[0-9][A-Za-z0-9.+~]*$/.test(v)) throw new Error(`Versión no válida para Debian: ${v}`);

  const raiz = await mkdtemp(join(tmpdir(), 'krakenos-deb-'));
  try {
    await chmod(raiz, 0o755); // mkdtemp la crea 0700
    await stageCommonTree(dir, raiz, `deb-${arch}`);

    const doc = join(raiz, 'usr', 'share', 'doc', 'krakenos');
    await mkdir(doc, { recursive: true });
    await cp(join(RAIZ, 'LICENSE'), join(doc, 'copyright'));
    await mkdir(join(raiz, 'usr', 'share', 'lintian', 'overrides'), { recursive: true });
    await cp(
      join(DEB, 'lintian-overrides'),
      join(raiz, 'usr', 'share', 'lintian', 'overrides', 'krakenos'),
    );
    for (const d of [
      'usr/share',
      'usr/share/doc',
      'usr/share/doc/krakenos',
      'usr/share/lintian',
      'usr/share/lintian/overrides',
    ])
      await chmod(join(raiz, d), 0o755);
    await chmod(join(doc, 'copyright'), 0o644);
    await chmod(join(raiz, 'usr', 'share', 'lintian', 'overrides', 'krakenos'), 0o644);
    // dpkg-deb exige 0755 en los directorios del sistema que crea el paquete.
    for (const d of [
      'usr',
      'usr/lib',
      'usr/lib/systemd',
      'usr/lib/systemd/system',
      'usr/lib/sysusers.d',
      'usr/lib/tmpfiles.d',
      'usr/bin',
    ])
      await chmod(join(raiz, d), 0o755);

    const du = ejecutar('du', ['-sk', '--apparent-size', raiz]);
    const installedSizeKb = Number.parseInt(du, 10);

    const ctl = join(raiz, 'DEBIAN');
    await mkdir(ctl, { mode: 0o755 });
    await writeFile(join(ctl, 'control'), renderControl({ version: v, arch, installedSizeKb }));
    for (const s of ['postinst', 'prerm', 'postrm']) {
      await cp(join(DEB, s), join(ctl, s));
      await chmod(join(ctl, s), 0o755);
    }
    await chmod(join(ctl, 'control'), 0o644);

    await mkdir(out, { recursive: true });
    const deb = join(out, debFileName(v, arch));
    ejecutar('dpkg-deb', ['--build', '--root-owner-group', '-Zxz', raiz, deb]);
    console.log(deb);
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(`ERROR: ${e.message}`);
  process.exit(1);
});
