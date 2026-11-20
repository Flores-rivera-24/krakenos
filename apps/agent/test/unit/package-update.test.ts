import { execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cerrarDispatcherLan, _resetCacheLan } from '../../src/net/lan-tls.js';
import { PrivilegedCommandError, type CommandRunner } from '../../src/privileged/runner.js';
import {
  defaultPackageTransport,
  localHealthUrl,
  packagePlatform,
  packageStagingDir,
  PackageUpdateRunner,
  type PackageTransport,
} from '../../src/system/package-update.js';
import { orchestrateUpdate, PACKAGE_STEPS } from '../../src/system/update-orchestrator.js';

const REPO = 'dueno/krakenos';
const BASE = `https://github.com/${REPO}/releases/download/v0.3.0`;
const PKG = Buffer.from('contenido-del-paquete');
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

function manifestBytes(over: Record<string, unknown> = {}, art: Record<string, unknown> = {}) {
  return Buffer.from(
    JSON.stringify({
      schema: 1,
      version: '0.3.0',
      minFrom: '0.2.0',
      artifacts: [
        {
          platform: 'deb-amd64',
          name: 'krakenos_0.3.0_amd64.deb',
          sha256: sha(PKG),
          size: PKG.length,
          ...art,
        },
      ],
      ...over,
    }),
  );
}
const sigOf = (b: Buffer) => sign(null, b, privateKey).toString('base64');

interface Scenario {
  manifest?: Buffer;
  sig?: string;
  pkg?: Buffer;
}

let dir: string;
let urls: string[];
let calls: string[][];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pkgupd-'));
  urls = [];
  calls = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function build(s: Scenario = {}, installed = '0.2.0', helperFails = false) {
  const manifest = s.manifest ?? manifestBytes();
  const sig = s.sig ?? sigOf(manifest);
  const pkg = s.pkg ?? PKG;
  const transport: PackageTransport = {
    async getBytes(url) {
      urls.push(url);
      return url.endsWith('.sig') ? Buffer.from(sig) : manifest;
    },
    async download(url, dest) {
      urls.push(url);
      await writeFile(dest, pkg);
      return { sha256: sha(pkg), size: pkg.length };
    },
  };
  const helper: CommandRunner = {
    async run(argv) {
      calls.push(argv);
      if (helperFails) throw new Error('apt falló');
      return { stdout: '', stderr: '', code: 0 };
    },
  };
  const snapshots: string[] = [];
  const runner = new PackageUpdateRunner({
    repo: REPO,
    installed,
    platform: 'deb-amd64',
    stagingDir: join(dir, 'updates'),
    dbFile: join(dir, 'dev.db'),
    helper,
    healthUrl: 'http://127.0.0.1:1/health/ready',
    publicKeyPem: pem,
    transport,
    snapshot: async (_db, dest) => void snapshots.push(dest),
    fetchFn: async () => ({ ok: true }),
    sleep: async () => {},
  });
  return { runner, snapshots };
}
const conCodigo = (runner: PackageUpdateRunner, code: number) => {
  (runner as unknown as { opts: { helper: CommandRunner } }).opts.helper = {
    async run(argv) {
      throw new PrivilegedCommandError(argv, { stdout: '', stderr: 'x', code });
    },
  };
};
const staged = async () => readdir(join(dir, 'updates')).catch(() => [] as string[]);

describe('PackageUpdateRunner.fetch: rechazos antes de descargar el paquete', () => {
  it('firma de otra clave', async () => {
    const otra = generateKeyPairSync('ed25519').privateKey;
    const m = manifestBytes();
    const { runner } = build({ manifest: m, sig: sign(null, m, otra).toString('base64') });
    await expect(runner.fetch('0.3.0')).rejects.toMatchObject({ code: 'BAD_SIGNATURE' });
    expect(urls.some((u) => u.endsWith('.deb'))).toBe(false);
    expect(await staged()).toEqual([]);
  });
  it('manifiesto alterado un byte', async () => {
    const m = manifestBytes();
    const sig = sigOf(m);
    const t = Buffer.from(m);
    t[12] = t[12]! ^ 1;
    const { runner } = build({ manifest: t, sig });
    await expect(runner.fetch('0.3.0')).rejects.toMatchObject({ code: 'BAD_SIGNATURE' });
    expect(urls.some((u) => u.endsWith('.deb'))).toBe(false);
  });
  it('.sig vacía', async () => {
    const { runner } = build({ sig: '' });
    await expect(runner.fetch('0.3.0')).rejects.toMatchObject({ code: 'BAD_SIGNATURE' });
    expect(urls.some((u) => u.endsWith('.deb'))).toBe(false);
  });
  it('versión igual a la instalada (manifiesto viejo con firma válida)', async () => {
    const { runner } = build({}, '0.3.0');
    await expect(runner.fetch('0.3.0')).rejects.toMatchObject({ code: 'NOT_AN_UPGRADE' });
    expect(urls.some((u) => u.endsWith('.deb'))).toBe(false);
  });
  it('downgrade', async () => {
    const { runner } = build({}, '0.9.0');
    await expect(runner.fetch('0.3.0')).rejects.toMatchObject({ code: 'NOT_AN_UPGRADE' });
    expect(urls.some((u) => u.endsWith('.deb'))).toBe(false);
  });
  it('instalada menor que minFrom: código propio', async () => {
    const { runner } = build({}, '0.1.0');
    await expect(runner.fetch('0.3.0')).rejects.toMatchObject({ code: 'MIN_FROM' });
    expect(urls.some((u) => u.endsWith('.deb'))).toBe(false);
  });
  it('plataforma sin artefacto', async () => {
    const m = manifestBytes({}, { platform: 'arch-x86_64', name: 'k-0.3.0.pkg.tar.zst' });
    const { runner } = build({ manifest: m });
    await expect(runner.fetch('0.3.0')).rejects.toMatchObject({ code: 'NO_ARTIFACT' });
    expect(urls.some((u) => /\.(deb|zst)$/.test(u))).toBe(false);
  });
  it('el manifiesto es de otra versión que la pedida', async () => {
    const m = manifestBytes({ version: '0.4.0' });
    const { runner } = build({ manifest: m });
    await expect(runner.fetch('0.3.0')).rejects.toMatchObject({ code: 'BAD_PACKAGE' });
    expect(urls.some((u) => u.endsWith('.deb'))).toBe(false);
  });
});

describe('PackageUpdateRunner.fetch: nunca sale del repo configurado (Review Focus 5)', () => {
  it('un artefacto con url o con nombre de otro host no se descarga', async () => {
    for (const art of [
      { url: 'https://evil.example/x.deb' },
      { name: 'https://evil.example/x.deb' },
      { name: '//evil.example/x.deb' },
    ]) {
      const { runner } = build({ manifest: manifestBytes({}, art) });
      await expect(runner.fetch('0.3.0')).rejects.toThrow(/manifiesto/i);
    }
    expect(urls.every((u) => u.startsWith(`${BASE}/`))).toBe(true);
    expect(urls.some((u) => u.endsWith('.deb'))).toBe(false);
  });
  it.each([
    'evil.example/../x?y',
    'dueno/..',
    'dueno/.',
    '../krakenos',
    './krakenos',
    '../..',
    'a/b/c',
  ])('un repo mal formado (%s) se rechaza antes de pedir nada', async (repo) => {
    const { runner } = build();
    const bad = new PackageUpdateRunner({
      ...(runner as unknown as { opts: ConstructorParameters<typeof PackageUpdateRunner>[0] }).opts,
      repo,
    });
    await expect(bad.fetch('0.3.0')).rejects.toThrow(/repositorio/i);
    expect(urls).toEqual([]);
  });
  it('camino feliz: pide manifiesto, firma y paquete solo bajo la release', async () => {
    const { runner } = build();
    await runner.fetch('0.3.0');
    expect(urls).toEqual([
      `${BASE}/manifest.json`,
      `${BASE}/manifest.json.sig`,
      `${BASE}/krakenos_0.3.0_amd64.deb`,
    ]);
  });
});

describe('PackageUpdateRunner.fetch: el paquete descargado', () => {
  it('suma distinta: BAD_PACKAGE y no queda ningún fichero', async () => {
    const { runner } = build({ pkg: Buffer.from('otro-contenido-distinto') });
    await expect(runner.fetch('0.3.0')).rejects.toMatchObject({ code: 'BAD_PACKAGE' });
    expect(await staged()).toEqual([]);
  });
  it('tamaño distinto con suma coincidente: BAD_PACKAGE y sin ficheros', async () => {
    const m = manifestBytes({}, { size: PKG.length + 1 });
    const { runner } = build({ manifest: m });
    await expect(runner.fetch('0.3.0')).rejects.toMatchObject({ code: 'BAD_PACKAGE' });
    expect(await staged()).toEqual([]);
  });
  it('si la descarga falla, no queda el .part', async () => {
    const { runner } = build();
    (runner as unknown as { opts: { transport: PackageTransport } }).opts.transport.download =
      async (_u, dest) => {
        await writeFile(dest, 'parcial');
        throw new Error('corte');
      };
    await expect(runner.fetch('0.3.0')).rejects.toThrow(/corte/);
    expect(await staged()).toEqual([]);
  });
  it('éxito: el paquete queda con su nombre y su contenido', async () => {
    const { runner } = build();
    await runner.fetch('0.3.0');
    expect(await staged()).toEqual([
      'krakenos_0.3.0_amd64.deb',
      'manifest.json',
      'manifest.json.sig',
    ]);
    expect(await readFile(join(dir, 'updates', 'krakenos_0.3.0_amd64.deb'))).toEqual(PKG);
    expect(await readFile(join(dir, 'updates', 'manifest.json'))).toEqual(manifestBytes());
    expect((await readFile(join(dir, 'updates', 'manifest.json.sig'), 'utf8')).trim()).toBe(
      sigOf(manifestBytes()),
    );
  });
});

describe('PackageUpdateRunner: backup, apply, healthcheck, rollback', () => {
  it('backup hace el snapshot de la base', async () => {
    const { runner, snapshots } = build();
    await runner.backup();
    expect(snapshots).toEqual([join(dir, 'dev.db.pre-update')]);
  });
  it('apply llama a pkg-update con la ruta verificada y la versión', async () => {
    const { runner } = build();
    await runner.fetch('0.3.0');
    await runner.apply();
    expect(calls).toEqual([
      [
        'pkg-update',
        join(dir, 'updates', 'krakenos_0.3.0_amd64.deb'),
        join(dir, 'updates', 'manifest.json'),
        join(dir, 'updates', 'manifest.json.sig'),
        '0.3.0',
      ],
    ]);
  });
  it('apply sin fetch previo no llama al helper', async () => {
    const { runner } = build();
    await expect(runner.apply()).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  it('rollback llama a pkg-rollback con la copia de la base y la versión que se instaló', async () => {
    const { runner } = build();
    await runner.fetch('0.3.0');
    await runner.rollback();
    expect(calls).toEqual([['pkg-rollback', join(dir, 'dev.db.pre-update'), '0.3.0']]);
  });
  it('rollback: el código 66 del helper (sin paquete anterior) llega con un marcador estable', async () => {
    const { runner } = build();
    await runner.fetch('0.3.0');
    const opts = (runner as unknown as { opts: { helper: CommandRunner } }).opts;
    opts.helper = {
      async run(argv) {
        throw new PrivilegedCommandError(argv, { stdout: '', stderr: 'sin anterior', code: 66 });
      },
    };
    await expect(runner.rollback()).rejects.toMatchObject({ code: 'NO_PREVIOUS_PACKAGE' });
  });
  it('rollback: otro fallo del helper se propaga tal cual', async () => {
    const { runner } = build();
    await runner.fetch('0.3.0');
    const opts = (runner as unknown as { opts: { helper: CommandRunner } }).opts;
    opts.helper = {
      async run(argv) {
        throw new PrivilegedCommandError(argv, { stdout: '', stderr: 'x', code: 1 });
      },
    };
    await expect(runner.rollback()).rejects.toThrow(/code 1/);
  });
  it('rollback sin paquete preparado (falló el fetch) no llama al helper y NO cuenta como reversión', async () => {
    const { runner } = build();
    await expect(runner.rollback()).rejects.toMatchObject({ code: 'STILL_INSTALLED' });
    expect(calls).toEqual([]);
  });
  it('rollback: 68 del helper (la nueva nunca se instaló) llega como STILL_INSTALLED', async () => {
    const { runner } = build();
    await runner.fetch('0.3.0');
    conCodigo(runner, 68);
    await expect(runner.rollback()).rejects.toMatchObject({ code: 'STILL_INSTALLED' });
  });
  it('rollback: 67 del helper (nada que revertir) es un fallo, no una reversión', async () => {
    const { runner } = build();
    await runner.fetch('0.3.0');
    conCodigo(runner, 67);
    const err = await runner.rollback().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toHaveProperty('code');
    expect((err as Error).message).toMatch(/nada|no tenía/);
  });
  it.each([
    [65, 'BAD_PACKAGE'],
    [64, 'INSTALL_REFUSED'],
    [69, 'INSTALL_REFUSED'],
  ])(
    'apply: el código %i del helper es un rechazo previo a instalar (%s)',
    async (code, motivo) => {
      const { runner } = build();
      await runner.fetch('0.3.0');
      conCodigo(runner, code);
      await expect(runner.apply()).rejects.toMatchObject({ code: motivo });
    },
  );
  it('apply: otros fallos del helper (p. ej. apt, 100) se propagan y SÍ piden rollback', async () => {
    const { runner } = build();
    await runner.fetch('0.3.0');
    conCodigo(runner, 100);
    await expect(runner.apply()).rejects.toThrow(/code 100/);
  });
  it('healthcheck correcto confirma la versión con pkg-commit', async () => {
    const { runner } = build();
    await runner.fetch('0.3.0');
    expect(await runner.healthcheck()).toBe(true);
    expect(calls).toEqual([['pkg-commit', '0.3.0']]);
  });
  it('healthcheck fallido NO confirma (el rollback sigue disponible)', async () => {
    const { runner } = build();
    await runner.fetch('0.3.0');
    const never = new PackageUpdateRunner({
      ...(runner as unknown as { opts: ConstructorParameters<typeof PackageUpdateRunner>[0] }).opts,
      fetchFn: async () => ({ ok: false }),
    });
    await never.fetch('0.3.0');
    calls.length = 0;
    expect(await never.healthcheck()).toBe(false);
    expect(calls).toEqual([]);
  });
  it('si pkg-commit falla, la actualización sigue siendo correcta y se avisa', async () => {
    const { runner } = build();
    await runner.fetch('0.3.0');
    const warns: string[] = [];
    const o = (runner as unknown as { opts: ConstructorParameters<typeof PackageUpdateRunner>[0] })
      .opts;
    const r2 = new PackageUpdateRunner({
      ...o,
      warn: (m) => warns.push(m),
      helper: {
        async run(argv) {
          throw new PrivilegedCommandError(argv, { stdout: '', stderr: 'x', code: 1 });
        },
      },
    });
    await r2.fetch('0.3.0');
    expect(await r2.healthcheck()).toBe(true);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatch(/pkg-commit/);
  });
  it('healthcheck: true si responde, false si nunca', async () => {
    const { runner } = build();
    expect(await runner.healthcheck()).toBe(true);
    const never = new PackageUpdateRunner({
      ...(runner as unknown as { opts: ConstructorParameters<typeof PackageUpdateRunner>[0] }).opts,
      fetchFn: async () => ({ ok: false }),
    });
    expect(await never.healthcheck()).toBe(false);
  });
});

describe('orquestador en modo paquete', () => {
  it('pasos backup → fetch → apply → healthcheck, sin migrate ni restart', async () => {
    const { runner } = build();
    const r = await orchestrateUpdate(runner, '0.2.0', '0.3.0', { steps: PACKAGE_STEPS });
    expect(r.ok).toBe(true);
    expect(r.steps.map((s) => s.step)).toEqual(['backup', 'fetch', 'apply', 'healthcheck']);
  });
  it('una firma mala aborta sin rollback ni helper', async () => {
    const { runner } = build({ sig: '' });
    const r = await orchestrateUpdate(runner, '0.2.0', '0.3.0', { steps: PACKAGE_STEPS });
    expect(r.ok).toBe(false);
    expect(r.rolledBack).toBe(false);
    expect(calls).toEqual([]);
    expect(r.steps.find((s) => s.step === 'fetch')).toMatchObject({
      status: 'failed',
      code: 'BAD_SIGNATURE',
    });
  });
  it('root rechaza al verificar (65): aborta sin rollback ni pkg-rollback y con motivo BAD_PACKAGE', async () => {
    const { runner } = build();
    conCodigo(runner, 65);
    const r = await orchestrateUpdate(runner, '0.2.0', '0.3.0', { steps: PACKAGE_STEPS });
    expect(r).toMatchObject({ ok: false, rolledBack: false });
    expect(r.steps.find((s) => s.step === 'apply')).toMatchObject({ code: 'BAD_PACKAGE' });
    expect(r.steps.map((s) => s.step)).not.toContain('rollback');
  });
  it('falla la descarga (red): no hay «reversión» ni rolledBack, sigue instalada la de antes', async () => {
    const { runner } = build();
    (runner as unknown as { opts: { transport: PackageTransport } }).opts.transport.getBytes =
      async () => {
        throw new Error('sin red');
      };
    const r = await orchestrateUpdate(runner, '0.2.0', '0.3.0', { steps: PACKAGE_STEPS });
    expect(r.rolledBack).toBe(false);
    expect(r.steps.find((s) => s.step === 'rollback')).toMatchObject({ code: 'STILL_INSTALLED' });
    expect(calls).toEqual([]);
  });
  it('si apt falla: rollback con pkg-rollback', async () => {
    const { runner } = build({}, '0.2.0', true);
    const r = await orchestrateUpdate(runner, '0.2.0', '0.3.0', { steps: PACKAGE_STEPS });
    expect(r.ok).toBe(false);
    // el helper falla también al revertir: no se puede afirmar que se revirtió
    expect(r.rolledBack).toBe(false);
    expect(r.steps.map((s) => [s.step, s.status])).toContainEqual(['rollback', 'failed']);
  });
});

describe('defaultPackageTransport (servidor local, sin red externa)', () => {
  let server: Server;
  let origin = '';
  beforeEach(async () => {
    const { createServer } = await import('node:http');
    server = createServer((req, res) => {
      if (req.url === '/404') return void res.writeHead(404).end();
      res.writeHead(200).end(Buffer.alloc(100, 7));
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(() => void server.close());

  it('getBytes lee el cuerpo y corta si pasa del tope', async () => {
    expect((await defaultPackageTransport.getBytes(`${origin}/x`, 1000)).length).toBe(100);
    await expect(defaultPackageTransport.getBytes(`${origin}/x`, 50)).rejects.toThrow(/más grande/);
  });
  it('download devuelve suma y tamaño, y corta si pasa del tope', async () => {
    const dest = join(dir, 'f');
    const r = await defaultPackageTransport.download(`${origin}/x`, dest, 1000);
    expect(r).toEqual({ sha256: sha(Buffer.alloc(100, 7)), size: 100 });
    await expect(defaultPackageTransport.download(`${origin}/x`, dest, 50)).rejects.toThrow(
      /más grande/,
    );
  });
  it('un HTTP distinto de 200 lanza', async () => {
    await expect(defaultPackageTransport.getBytes(`${origin}/404`, 1000)).rejects.toThrow(/404/);
  });
});

describe('valores de producción del actualizador (los que ata update-runner)', () => {
  it('el staging del agente es <datos>/data/updates', () => {
    expect(packageStagingDir('/var/lib/krakenos/data')).toBe('/var/lib/krakenos/data/updates');
  });
  it('localHealthUrl: HTTPS con HTTPS_ENABLED=true (lo que deja `tls auto`), HTTP sin él, y el override manda', () => {
    expect(localHealthUrl({ PORT: '3001', HTTPS_ENABLED: 'true' })).toBe(
      'https://127.0.0.1:3001/health/ready',
    );
    expect(localHealthUrl({ PORT: '8080' })).toBe('http://127.0.0.1:8080/health/ready');
    expect(localHealthUrl({ HTTPS_ENABLED: 'false' })).toBe('http://127.0.0.1:3001/health/ready');
    expect(localHealthUrl({ HTTPS_ENABLED: 'true', KRAKENOS_HEALTH_URL: 'http://x/y' })).toBe(
      'http://x/y',
    );
  });
  it('packagePlatform: manda lo que fija el paquete; la heurística solo es respaldo', () => {
    const nada = () => false;
    expect(packagePlatform({ KRAKENOS_PACKAGE_PLATFORM: 'arch-x86_64' }, () => true, 'arm64')).toBe(
      'arch-x86_64',
    );
    expect(packagePlatform({ KRAKENOS_PACKAGE_PLATFORM: 'deb-arm64' }, nada, 'x64')).toBe(
      'deb-arm64',
    );
    // valor desconocido: se ignora y se usa el respaldo
    expect(packagePlatform({ KRAKENOS_PACKAGE_PLATFORM: 'rpm' }, nada, 'arm64')).toBe('deb-arm64');
    expect(packagePlatform({}, (p) => p === '/usr/bin/pacman', 'x64')).toBe('arch-x86_64');
    expect(packagePlatform({}, nada, 'x64')).toBe('deb-amd64');
  });
  it('update-runner usa esas mismas funciones (no valores propios)', () => {
    const src = readFileSync(new URL('../../src/update-runner.ts', import.meta.url), 'utf8');
    expect(src).toContain('packageStagingDir(agentPaths().dataDir)');
    expect(src).toContain('localHealthUrl(process.env)');
    expect(src).toContain('packagePlatform(process.env)');
    expect(src).not.toMatch(/resolve\(agentPaths\(\)\.dataDir, 'updates'\)/);
  });
});

describe('healthcheck contra el HTTPS del paquete (certificado que Node no conoce)', () => {
  let tdir: string;
  let server: ReturnType<typeof createHttpsServer>;
  let port = 0;
  beforeAll(async () => {
    tdir = await mkdtemp(join(tmpdir(), 'pkgupd-tls-'));
    const key = join(tdir, 'k.pem');
    const cert = join(tdir, 'c.pem');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-keyout',
        key,
        '-out',
        cert,
        '-days',
        '1',
        '-nodes',
        '-subj',
        '/CN=localhost',
      ],
      { stdio: 'pipe' },
    );
    server = createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (_q, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"status":"ready"}');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await cerrarDispatcherLan();
    _resetCacheLan();
    await rm(tdir, { recursive: true, force: true });
  });

  /** Runner con el `fetchFn` por defecto (el real) y la URL que calcula producción. */
  function conWiring(env: Parameters<typeof localHealthUrl>[0]) {
    const { runner } = build();
    const o = (runner as unknown as { opts: ConstructorParameters<typeof PackageUpdateRunner>[0] })
      .opts;
    const { fetchFn: _omit, ...resto } = o;
    return new PackageUpdateRunner({
      ...resto,
      healthUrl: localHealthUrl({ ...env, PORT: String(port) }),
    });
  }

  it('con HTTPS_ENABLED=true el healthcheck por defecto responde que sí (https en loopback, TLS saltado solo ahí)', async () => {
    expect(await conWiring({ HTTPS_ENABLED: 'true' }).healthcheck()).toBe(true);
  });
  it('la URL http de antes habría fallado siempre contra ese servidor (la causa del rollback a los 30 s)', async () => {
    expect(await conWiring({}).healthcheck()).toBe(false);
  });
});
