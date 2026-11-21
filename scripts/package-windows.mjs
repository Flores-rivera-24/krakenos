/**
 * `node scripts/package-windows.mjs <carpeta-us284> [--version <v>] [--out out/]`: construye
 * `KrakenOS-Setup-<v>-x64.exe` (NSIS, por el bundler de Tauri) con la carpeta de `pnpm package`
 * como recursos, y escribe su ruta en stdout. `--version` existe para la prueba de actualización.
 */
import { spawnSync } from 'node:child_process';
import {
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installWinsw } from './package/winsw.mjs';
import { checkSize } from './package/size-budget.mjs';
import { buildTauriConfig, installerFileName } from './package/windows-installer.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NSIS = join(RAIZ, 'apps', 'window', 'src-tauri', 'target', 'release', 'bundle', 'nsis');

function args(argv) {
  const o = { dir: undefined, version: undefined, out: join(RAIZ, 'out') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--version') o.version = argv[++i];
    else if (argv[i] === '--out') o.out = resolve(argv[++i] ?? '');
    else if (!o.dir) o.dir = resolve(argv[i]);
    else throw new Error(`Argumento inesperado: ${argv[i]}`);
  }
  if (!o.dir) throw new Error('uso: package-windows.mjs <carpeta> [--version <v>] [--out <dir>]');
  return o;
}

async function main() {
  const { dir, version, out } = args(process.argv.slice(2));
  if (!/-win-x64$/.test(basename(dir)))
    throw new Error(`${basename(dir)} no es un paquete win-x64`);
  const v = version ?? JSON.parse(await readFile(join(RAIZ, 'package.json'), 'utf8')).version;

  // Antes de tocar nada más: un WinSW que no verifica aborta el build por la suma.
  // Puerto 3001 por defecto; el instalador (Task 3) elige el libre al instalar.
  await installWinsw(dir, process.env.KRAKENOS_WINSW_CACHE ?? join(RAIZ, '.cache', 'winsw'), 3001);

  // Los pasos del instalador (ACL, primer arranque, servicio) corren con el Node empaquetado, desde Program Files.
  await cp(join(RAIZ, 'packaging', 'windows', 'installer'), join(dir, 'installer'), {
    recursive: true,
  });

  // Avisos de terceros del propio instalador (WinSW, NSIS, Tauri); NSIS los deja en `<instalación>\licenses`.
  await mkdir(join(dir, 'licenses'), { recursive: true });
  await copyFile(
    join(RAIZ, 'packaging', 'windows', 'THIRD-PARTY-WINDOWS.txt'),
    join(dir, 'licenses', 'THIRD-PARTY-WINDOWS.txt'),
  );

  // PRUEBA-ROJO-TEMPORAL
  await writeFile(join(dir, 'licenses', 'relleno.bin'), (await import('node:crypto')).randomBytes(8 * 1048576));

  const tmp = await mkdtemp(join(tmpdir(), 'krakenos-nsis-'));
  try {
    const override = join(tmp, 'tauri.override.json');
    const fwd = (p) => p.replaceAll('\\', '/');
    await writeFile(
      override,
      JSON.stringify(
        buildTauriConfig({
          version: v,
          payloadDir: fwd(dir),
          hooksPath: fwd(join(RAIZ, 'packaging', 'windows', 'installer-hooks.nsh')),
        }),
      ),
    );
    // La salida de tauri va a stderr: stdout queda solo para la ruta del .exe.
    const r = spawnSync(
      'pnpm',
      [
        '--filter',
        '@krakenos/window',
        'tauri',
        'build',
        '--bundles',
        'nsis',
        '--config',
        override,
        '--',
        '--locked',
      ],
      { stdio: ['ignore', 2, 2], cwd: RAIZ, shell: process.platform === 'win32' },
    );
    if (r.status !== 0) throw new Error(`tauri build salió con ${r.status}`);

    // Tauri lo nombra `<producto>_<versión>_x64-setup.exe`; la carpeta puede guardar otras versiones.
    const exes = (await readdir(NSIS)).filter((f) => f.endsWith(`_${v}_x64-setup.exe`));
    if (exes.length !== 1)
      throw new Error(`esperaba un solo *_${v}_x64-setup.exe en ${NSIS}: ${exes}`);
    await mkdir(out, { recursive: true });
    const destino = join(out, installerFileName(v));
    await copyFile(join(NSIS, exes[0]), destino);
    // Presupuesto de tamaño del instalador (medido + 5 %, en size-budget.json).
    const mb = (await stat(destino)).size / 1048576;
    console.error(`instalador: ${mb.toFixed(1)} MB`);
    const presupuesto = JSON.parse(
      await readFile(join(RAIZ, 'scripts', 'package', 'size-budget.json'), 'utf8'),
    )['installer-win-x64'];
    if (!presupuesto) throw new Error('size-budget.json no tiene entrada para installer-win-x64');
    checkSize(mb, presupuesto);
    process.stdout.write(`${destino}\n`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
