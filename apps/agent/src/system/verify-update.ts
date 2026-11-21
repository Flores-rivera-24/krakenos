/**
 * Verificación de una actualización por paquete que ejecuta ROOT (US-291a). La usa el helper
 * sobre SU copia del paquete: firma del manifiesto, versión, plataforma, nombre, tamaño y suma.
 * Reutiliza la lógica del agente (`update-manifest.ts`), así que agente y root no pueden discrepar.
 *
 * Se empaqueta autocontenida (`tsup.root.config.ts` → `dist/verify-update.js`) y NUNCA recibe la
 * clave por argumento ni por entorno: el punto de entrada pasa la embebida.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import {
  artifactFor,
  checkUpgrade,
  PLATFORMS,
  verifyAndParse,
  type Platform,
} from './update-manifest.js';

export interface VerifyUpdateOptions {
  manifestFile: string;
  sigFile: string;
  packageFile: string;
  platform: Platform;
  /** Versión del manifiesto que se espera (la que pidió el agente). */
  version: string;
  /** Versión instalada (la lee el helper del gestor de paquetes). `null` en un rollback: no hay upgrade que comprobar. */
  installed: string | null;
  publicKeyPem: string;
}

async function regularFile(file: string, what: string): Promise<number> {
  const st = await lstat(file);
  if (!st.isFile()) throw new Error(`${what} no es un fichero normal.`);
  return st.size;
}

async function sha256Of(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export async function verifyUpdate(o: VerifyUpdateOptions): Promise<void> {
  await regularFile(o.manifestFile, 'El manifiesto');
  await regularFile(o.sigFile, 'La firma');
  const size = await regularFile(o.packageFile, 'El paquete');
  const manifest = verifyAndParse(
    await readFile(o.manifestFile),
    (await readFile(o.sigFile)).toString('utf8'),
    o.publicKeyPem,
  );
  if (manifest.version !== o.version)
    throw new Error(`El manifiesto es de la versión ${manifest.version}, no de la ${o.version}.`);
  if (o.installed !== null) checkUpgrade(manifest, o.installed);
  const art = artifactFor(manifest, o.platform);
  if (basename(o.packageFile) !== art.name)
    throw new Error('El nombre del paquete no es el que dice el manifiesto firmado.');
  if (size !== art.size) throw new Error('El tamaño del paquete no coincide con el manifiesto.');
  if ((await sha256Of(o.packageFile)) !== art.sha256)
    throw new Error('La suma del paquete no coincide con el manifiesto firmado.');
}

const FLAGS = ['manifest', 'sig', 'package', 'platform', 'version', 'installed'] as const;

/** `--manifest f --sig f --package f --platform p --version v (--installed v | --rollback)`; 0 ok, 1 rechazo, 2 uso. */
export async function runVerifyCli(
  argv: string[],
  publicKeyPem: string,
  err: (line: string) => void,
): Promise<number> {
  const v: Record<string, string> = {};
  let rollback = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--rollback') rollback = true;
    else if (
      a.startsWith('--') &&
      (FLAGS as readonly string[]).includes(a.slice(2)) &&
      i + 1 < argv.length
    )
      v[a.slice(2)] = argv[++i]!;
    else {
      err(`Argumento no válido: ${a}`);
      return 2;
    }
  }
  const need = rollback ? FLAGS.filter((f) => f !== 'installed') : FLAGS;
  const missing = need.filter((f) => !v[f]);
  if (
    missing.length ||
    (rollback && v.installed !== undefined) ||
    !PLATFORMS.includes(v.platform as Platform)
  ) {
    err('Uso: --manifest --sig --package --platform --version (--installed | --rollback)');
    return 2;
  }
  try {
    await verifyUpdate({
      manifestFile: v.manifest!,
      sigFile: v.sig!,
      packageFile: v.package!,
      platform: v.platform as Platform,
      version: v.version!,
      installed: rollback ? null : v.installed!,
      publicKeyPem,
    });
    return 0;
  } catch (e) {
    err(e instanceof Error ? e.message : 'Verificación fallida.');
    return 1;
  }
}
