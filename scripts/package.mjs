/**
 * `pnpm package`: deja en `out/krakenos-<versión>-<plataforma>/` la carpeta autocontenida
 * (Node + agente + web + lanzador) de la plataforma del host. Sin compilación cruzada:
 * cada plataforma se empaqueta en su propia máquina o runner.
 *
 * Disposición y razones: docs/internal/plan-us284-package-2026-10-29.md.
 */
import { spawn } from 'node:child_process';
import { chmod, copyFile, cp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE_VERSION, resolveTarget } from './package/target.mjs';
import {
  NODE_KEYRING,
  assertSha256,
  expectedSha256,
  verifySignature,
} from './package/node-runtime.mjs';
import { assertNoSecrets, pruneNodeModules, pruneUnreachable } from './package/prune.mjs';
import { collectThirdPartyLicenses } from './package/licenses.mjs';
import { renombrarConReintento } from './package/rename-retry.mjs';
import { relinkPnpmJunctions } from './package/relink.mjs';
import { checkSize, dirSizeMb } from './package/size-budget.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Carpeta de la caché de Node (llavero, SHASUMS, firma y archivo). KRAKENOS_NODE_CACHE la
// cambia: la CI la usa para probar que una SHASUMS256.txt alterada NO pasa la firma.
// Sin la variable, la caché lleva la versión en la ruta: al subir NODE_VERSION no se reutiliza
// la SHASUMS de la anterior.
const CACHE_NODE = process.env.KRAKENOS_NODE_CACHE
  ? resolve(process.env.KRAKENOS_NODE_CACHE)
  : join(RAIZ, '.cache', 'node', NODE_VERSION);
const TOTAL = 9;
const paso = (n, texto) => console.log(`==> [${n}/${TOTAL}] ${texto}`);

/** Ejecuta un comando heredando la salida; lanza si no sale con 0. */
function ejecutar(cmd, args, opts = {}) {
  return new Promise((ok, fallo) => {
    const p = spawn(cmd, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32' && cmd === 'pnpm',
      ...opts,
    });
    p.on('error', fallo);
    p.on('close', (code) =>
      code === 0 ? ok(undefined) : fallo(new Error(`${cmd} ${args.join(' ')} salió con ${code}`)),
    );
  });
}

/** Como `ejecutar`, pero captura stderr y devuelve el código (lo que pide `verifySignature`). */
function ejecutarCapturando(cmd, args, { cwd } = {}) {
  return new Promise((ok, fallo) => {
    let stderr = '';
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] });
    p.stderr.on('data', (d) => (stderr += d));
    p.on('error', (e) =>
      fallo(new Error(`No pude ejecutar ${cmd} (¿está instalado y en el PATH?): ${e.message}`)),
    );
    p.on('close', (code) => ok({ code: code ?? 1, stderr }));
  });
}

async function descargar(url, destino) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} respondió ${r.status}`);
  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, Buffer.from(await r.arrayBuffer()));
}

/** Baja y verifica Node (llavero → firma → suma) y devuelve la ruta del archivo verificado. */
async function nodeVerificado(target) {
  const cache = CACHE_NODE;
  const base = `https://nodejs.org/dist/v${NODE_VERSION}`;
  const keyring = join(cache, 'pubring.kbx');
  await descargar(NODE_KEYRING.url, keyring);
  await assertSha256(keyring, NODE_KEYRING.sha256);

  const sums = join(cache, 'SHASUMS256.txt');
  const sig = join(cache, 'SHASUMS256.txt.sig');
  // Si ya están en la caché se reutilizan: nada se da por bueno sin pasar la firma de abajo,
  // y así una copia alterada a mano se ve rechazada en vez de sobrescrita en silencio.
  if (!existsSync(sums)) await descargar(`${base}/SHASUMS256.txt`, sums);
  if (!existsSync(sig)) await descargar(`${base}/SHASUMS256.txt.sig`, sig);
  const pista = (e) =>
    new Error(
      `${e.message}\nSi no modificaste ${cache} a propósito, bórrala y vuelve a empaquetar.`,
    );
  try {
    await verifySignature({
      run: ejecutarCapturando,
      dir: cache,
      keyring: 'pubring.kbx',
      signature: 'SHASUMS256.txt.sig',
      file: 'SHASUMS256.txt',
    });
  } catch (e) {
    throw pista(e);
  }

  const esperada = expectedSha256(await readFile(sums, 'utf8'), target.nodeArchive);
  const archivo = join(cache, target.nodeArchive);
  if (!existsSync(archivo)) await descargar(`${base}/${target.nodeArchive}`, archivo);
  try {
    await assertSha256(archivo, esperada);
  } catch (e) {
    throw pista(e);
  }
  return archivo;
}

async function main() {
  const target = resolveTarget(process.platform, process.arch);
  // Solo el paso de Node (descarga a la caché + verificación): la CI lo usa para el negativo de la firma.
  if (process.argv.includes('--only-node')) {
    await nodeVerificado(target);
    console.log('Node verificado (llavero, firma y suma).');
    return;
  }
  const rootPkg = JSON.parse(await readFile(join(RAIZ, 'package.json'), 'utf8'));
  const sha = await new Promise((ok, fallo) => {
    let out = '';
    const p = spawn('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: RAIZ,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    p.stdout.on('data', (d) => (out += d));
    p.on('error', fallo);
    p.on('close', (c) => (c === 0 ? ok(out.trim()) : fallo(new Error('git rev-parse falló'))));
  });
  const version = `${rootPkg.version} ${sha}`;
  const outDir = join(RAIZ, 'out');
  const pkg = join(outDir, `krakenos-${rootPkg.version}-${target.id}`);
  const tmpDeploy = join(outDir, '.deploy-tmp');
  const app = join(pkg, 'app');
  const agente = join(app, 'agent');

  paso(1, `destino ${target.id}, versión ${version}`);
  await rm(pkg, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  await rm(tmpDeploy, { recursive: true, force: true });
  await mkdir(agente, { recursive: true });

  paso(2, 'pnpm build');
  await ejecutar('pnpm', ['build'], { cwd: RAIZ });

  paso(3, 'pnpm deploy --prod (solo se toma node_modules)');
  await ejecutar(
    'pnpm',
    ['--filter', '@krakenos/agent', 'deploy', '--prod', '--ignore-scripts', tmpDeploy],
    { cwd: RAIZ },
  );

  paso(4, 'prebuild de better-sqlite3 para esta plataforma');
  const bsReal = await realpath(join(tmpDeploy, 'node_modules', 'better-sqlite3'));
  // --runtime/--target: el binario es para el Node que se empaqueta, no para el del host.
  await ejecutar(
    process.execPath,
    [
      join(dirname(bsReal), 'prebuild-install', 'bin.js'),
      '--runtime=node',
      `--target=${NODE_VERSION}`,
    ],
    { cwd: bsReal },
  );
  if (!existsSync(join(bsReal, 'build', 'Release', 'better_sqlite3.node'))) {
    throw new Error('prebuild-install no dejó better_sqlite3.node: no se compila en silencio');
  }

  paso(5, 'copiando agente, web, migraciones y lanzador');
  await renombrarConReintento(join(tmpDeploy, 'node_modules'), join(agente, 'node_modules'));
  await rm(tmpDeploy, { recursive: true, force: true });
  // En Windows los enlaces de pnpm son absolutos hacia el deploy temporal: hay que rehacerlos.
  const rl = await relinkPnpmJunctions(join(agente, 'node_modules'));
  console.log(
    `    enlaces de pnpm rehechos: ${rl.relinked.length}; sin resolver: ${rl.unresolved.length}`,
  );
  for (const u of rl.unresolved) console.log(`      sin resolver: ${u}`);
  await cp(join(RAIZ, 'apps/agent/dist'), join(agente, 'dist'), { recursive: true });
  await cp(join(RAIZ, 'apps/agent/prisma/migrations'), join(agente, 'prisma', 'migrations'), {
    recursive: true,
  });
  await copyFile(join(RAIZ, 'apps/agent/package.json'), join(agente, 'package.json'));
  await copyFile(join(RAIZ, 'apps/agent/.env.example'), join(agente, '.env.example'));
  await cp(join(RAIZ, 'apps/web/dist'), join(app, 'web', 'dist'), { recursive: true });
  await copyFile(join(RAIZ, 'LICENSE'), join(pkg, 'LICENSE'));
  await copyFile(join(RAIZ, 'scripts/package/launchers/first-run.mjs'), join(app, 'first-run.mjs'));
  await copyFile(join(RAIZ, 'scripts/package/relink.mjs'), join(app, 'relink.mjs'));
  const lanzador = join(pkg, target.launcher);
  await mkdir(dirname(lanzador), { recursive: true });
  await copyFile(
    join(RAIZ, 'scripts/package/launchers', target.launcher.split('/').pop()),
    lanzador,
  );
  if (process.platform !== 'win32') await chmod(lanzador, 0o755);

  paso(6, `Node ${NODE_VERSION} (llavero, firma y suma verificados)`);
  const archivo = await nodeVerificado(target);
  const ext = join(outDir, '.node-tmp');
  await rm(ext, { recursive: true, force: true });
  await mkdir(ext, { recursive: true });
  // En Windows, el tar.exe del sistema (bsdtar): un GNU tar de Git en el PATH no abre el zip.
  const tar =
    process.platform === 'win32'
      ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
      : 'tar';
  await ejecutar(tar, [archivo.endsWith('.zip') ? '-xf' : '-xJf', archivo, '-C', ext]);
  const raizNode = join(ext, target.nodeArchive.replace(/\.(zip|tar\.xz)$/, ''));
  const destNode = join(pkg, 'node');
  const nodeBin = target.nodeBin.replace(/^node\//, '');
  await mkdir(dirname(join(destNode, nodeBin)), { recursive: true });
  await copyFile(join(raizNode, nodeBin), join(destNode, nodeBin));
  await copyFile(join(raizNode, 'LICENSE'), join(destNode, 'LICENSE'));
  if (process.platform !== 'win32') await chmod(join(destNode, nodeBin), 0o755);
  await rm(ext, { recursive: true, force: true });

  paso(7, 'poda de node_modules');
  const nm = join(agente, 'node_modules');
  const a = await pruneNodeModules(nm);
  const b = await pruneUnreachable(nm);
  console.log(
    `    WASM y CLI: ${a.removed.length} entradas, ${(a.freedBytes / 1048576).toFixed(1)} MB; huérfanos de .pnpm: ${b.removed.length}`,
  );

  paso(8, 'THIRD_PARTY_LICENSES.txt y VERSION');
  await writeFile(join(pkg, 'THIRD_PARTY_LICENSES.txt'), await collectThirdPartyLicenses(nm));
  await writeFile(join(pkg, 'VERSION'), `${version}\n`);

  paso(9, 'comprobando que no viaja ningún secreto');
  await assertNoSecrets(pkg);

  const mb = await dirSizeMb(pkg);
  console.log(`Paquete listo: ${pkg} (${mb.toFixed(1)} MB)`);
  const presupuesto = JSON.parse(
    await readFile(join(RAIZ, 'scripts/package/size-budget.json'), 'utf8'),
  )[target.id];
  if (!presupuesto) throw new Error(`size-budget.json no tiene entrada para ${target.id}`);
  checkSize(mb, presupuesto);
}

main().catch((e) => {
  console.error(`pnpm package falló: ${e.message}`);
  process.exit(1);
});
