/**
 * Actualización por paquete (US-291a): el agente (sin privilegios) descarga el
 * manifiesto firmado, la firma y el paquete de SU plataforma, lo verifica todo y
 * solo entonces pide al helper de root que lo instale (`pkg-update`). Root vuelve a
 * verificar por su cuenta: aquí nada se da por bueno solo porque el agente lo vio.
 *
 * Descarga y helper son inyectables (patrón de `ProcessUpdateRunner`): los tests no
 * tocan red ni apt. Toda petición va por `safeFetch` y solo a
 * `https://github.com/<repo>/releases/download/v<versión>/…`; el paquete se pide por
 * el `name` del manifiesto bajo esa misma ruta, jamás por una URL que traiga dentro.
 */

import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { safeFetch } from '../net/egress.js';
import { PrivilegedCommandError, type CommandRunner } from '../privileged/runner.js';
import { renameWithRetry } from './rename-retry.js';
import { UpdateBlockedError } from './node-requirement.js';
import {
  artifactFor,
  checkUpgrade,
  UPDATE_PUBLIC_KEY_PEM,
  verifyAndParse,
  type Platform,
} from './update-manifest.js';
import type { UpdateRunner } from './update-orchestrator.js';

export interface PackageTransport {
  /** Descarga un recurso pequeño en memoria; lanza si no es 200 o supera `maxBytes`. */
  getBytes(url: string, maxBytes: number): Promise<Buffer>;
  /** Descarga a `destFile` sin pasar de `maxBytes`; devuelve la suma y el tamaño reales. */
  download(
    url: string,
    destFile: string,
    maxBytes: number,
  ): Promise<{ sha256: string; size: number }>;
}

const MANIFEST_MAX = 256 * 1024;
const SIG_MAX = 1024;
const DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const HEALTH_RETRIES = 10;
const HEALTH_INTERVAL_MS = 3000;
// `dueño/repo` con la forma de GitHub: nada de `..`, `?`, `#` ni dominios en medio.
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]*\/(?!\.\.?$)[A-Za-z0-9._-]+$/;
const TARGET = /^\d+\.\d+\.\d+$/;

async function okResponse(url: string, timeoutMs: number): Promise<Response> {
  const res = await safeFetch(url, {
    headers: { 'User-Agent': 'KrakenOS' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok)
    throw new Error(`No se pudo descargar ${url.split('/').pop()} (HTTP ${res.status}).`);
  return res;
}

/** Corta el flujo en cuanto pasa de `max` bytes y calcula la suma al vuelo. */
function limiter(max: number, hash: ReturnType<typeof createHash>, count: { n: number }) {
  return new Transform({
    transform(chunk: Buffer, _enc, cb) {
      count.n += chunk.length;
      if (count.n > max)
        return cb(new Error('El paquete es más grande de lo que dice el manifiesto.'));
      hash.update(chunk);
      cb(null, chunk);
    },
  });
}

export const defaultPackageTransport: PackageTransport = {
  async getBytes(url, maxBytes) {
    const res = await okResponse(url, 10_000);
    if (!res.body) throw new Error('Respuesta vacía.');
    const parts: Buffer[] = [];
    const count = { n: 0 };
    await pipeline(
      Readable.fromWeb(res.body as never),
      limiter(maxBytes, createHash('sha256'), count),
      async function (src: AsyncIterable<Buffer>) {
        for await (const c of src) parts.push(c);
      },
    );
    return Buffer.concat(parts);
  },
  async download(url, destFile, maxBytes) {
    const res = await okResponse(url, DOWNLOAD_TIMEOUT_MS);
    if (!res.body) throw new Error('Respuesta vacía.');
    const hash = createHash('sha256');
    const count = { n: 0 };
    await pipeline(
      Readable.fromWeb(res.body as never),
      limiter(maxBytes, hash, count),
      createWriteStream(destFile, { mode: 0o600 }),
    );
    return { sha256: hash.digest('hex'), size: count.n };
  },
};

export interface PackageUpdateRunnerOptions {
  /** `dueño/repo` de `UPDATE_CHECK_REPO`. */
  repo: string;
  /** Versión instalada ahora (anti-downgrade). */
  installed: string;
  platform: Platform;
  /** Directorio del servicio donde se prepara el paquete (root lo copia a su sitio). */
  stagingDir: string;
  dbFile: string;
  helper: CommandRunner;
  healthUrl: string;
  publicKeyPem?: string;
  transport?: PackageTransport;
  snapshot: (dbFile: string, destFile: string) => Promise<void>;
  fetchFn?: (url: string) => Promise<{ ok: boolean }>;
  sleep?: (ms: number) => Promise<void>;
}

export class PackageUpdateRunner implements UpdateRunner {
  private staged: { pkg: string; manifest: string; sig: string; version: string } | null = null;

  constructor(private readonly opts: PackageUpdateRunnerOptions) {}

  async backup(): Promise<void> {
    await this.opts.snapshot(this.opts.dbFile, `${this.opts.dbFile}.pre-update`);
  }

  async fetch(targetVersion: string): Promise<void> {
    const { repo, stagingDir } = this.opts;
    if (!REPO.test(repo)) throw new Error('El repositorio de actualizaciones no es válido.');
    if (!TARGET.test(targetVersion)) throw new Error('La versión de destino no es válida.');
    const transport = this.opts.transport ?? defaultPackageTransport;
    const base = `https://github.com/${repo}/releases/download/v${targetVersion}`;

    // Firma y upgrade se resuelven ANTES de pedir el paquete.
    const bytes = await transport.getBytes(`${base}/manifest.json`, MANIFEST_MAX);
    const sigBytes = await transport.getBytes(`${base}/manifest.json.sig`, SIG_MAX);
    const manifest = verifyAndParse(
      bytes,
      sigBytes.toString('utf8'),
      this.opts.publicKeyPem ?? UPDATE_PUBLIC_KEY_PEM,
    );
    if (manifest.version !== targetVersion) {
      throw new UpdateBlockedError(
        'BAD_PACKAGE',
        `El manifiesto es de la versión ${manifest.version}, no de la ${targetVersion}.`,
      );
    }
    checkUpgrade(manifest, this.opts.installed);
    const art = artifactFor(manifest, this.opts.platform);

    // Directorio limpio: nada de restos de un intento anterior que el helper pudiera recoger.
    await mkdir(stagingDir, { recursive: true, mode: 0o700 });
    for (const f of await readdir(stagingDir)) await rm(join(stagingDir, f), { force: true });
    // Root vuelve a verificar: se dejan los bytes EXACTOS que verificó el agente. Todo va
    // a nombre temporal y solo se renombra cuando el paquete cuadra; si algo falla, no queda nada.
    const names = ['manifest.json', 'manifest.json.sig', art.name];
    const part = (n: string) => join(stagingDir, `.${n}.part`);
    try {
      await writeFile(part(names[0]!), bytes, { mode: 0o600 });
      await writeFile(part(names[1]!), sigBytes, { mode: 0o600 });
      const got = await transport.download(`${base}/${art.name}`, part(art.name), art.size);
      if (got.size !== art.size || got.sha256 !== art.sha256) {
        throw new UpdateBlockedError(
          'BAD_PACKAGE',
          'El paquete descargado no coincide con el manifiesto firmado (suma o tamaño); no se instala.',
        );
      }
      for (const n of names) await renameWithRetry(part(n), join(stagingDir, n));
    } catch (err) {
      for (const n of names) {
        await rm(part(n), { force: true });
        await rm(join(stagingDir, n), { force: true });
      }
      throw err;
    }
    this.staged = {
      pkg: join(stagingDir, art.name),
      manifest: join(stagingDir, names[0]!),
      sig: join(stagingDir, names[1]!),
      version: targetVersion,
    };
  }

  async apply(): Promise<void> {
    if (!this.staged) throw new Error('No hay paquete verificado que instalar.');
    // Contrato de `pkg-update <paquete> <manifest.json> <manifest.json.sig> <versión>`: root copia los
    // tres a su directorio y vuelve a verificar SU copia con la clave embebida; solo instala desde ella.
    const { pkg, manifest, sig, version } = this.staged;
    await this.opts.helper.run(['pkg-update', pkg, manifest, sig, version]);
  }

  // El paquete migra al arrancar y su postinst reinicia el servicio: no hay paso propio.
  async migrate(): Promise<void> {
    throw new Error('El modo paquete no tiene paso migrate.');
  }
  async restart(): Promise<void> {
    throw new Error('El modo paquete no tiene paso restart.');
  }

  async healthcheck(): Promise<boolean> {
    const fetchFn = this.opts.fetchFn ?? ((url) => safeFetch(url).then((r) => ({ ok: r.ok })));
    const sleep = this.opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
    for (let i = 0; i < HEALTH_RETRIES; i++) {
      try {
        if ((await fetchFn(this.opts.healthUrl)).ok) return true;
      } catch {
        // aún reiniciando
      }
      await sleep(HEALTH_INTERVAL_MS);
    }
    return false;
  }

  async rollback(): Promise<void> {
    // Sin paquete preparado (falló el `fetch`) root no ha instalado nada: no hay nada que revertir y
    // pedirlo solo expondría una actualización anterior a un fallo de red.
    if (!this.staged) return;
    // El agente no puede pararse a sí mismo para restaurar su base: lo hace el helper, desde la copia
    // que dejó el paso `backup`. Se le dice QUÉ versión falló: solo revierte si es la que él instaló.
    try {
      await this.opts.helper.run([
        'pkg-rollback',
        `${this.opts.dbFile}.pre-update`,
        this.staged.version,
      ]);
    } catch (err) {
      // 66 = `PKG_RC_NO_PREVIOUS` del helper: restauró la base pero no hay paquete anterior que reinstalar
      // (primera actualización por paquete). La UI lo distingue por este prefijo estable.
      if (err instanceof PrivilegedCommandError && err.result.code === 66) {
        throw new Error(
          'NO_PREVIOUS_PACKAGE: base restaurada, sin paquete anterior que reinstalar',
        );
      }
      throw err;
    }
  }
}
