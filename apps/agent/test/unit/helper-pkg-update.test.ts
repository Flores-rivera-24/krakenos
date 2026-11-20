import { execFile, execFileSync } from 'node:child_process';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

/**
 * `pkg-update` / `pkg-rollback` del helper (corre como ROOT e instala paquetes). Se ejecuta el
 * script real con bash; dpkg-query/dpkg/apt-get/systemctl son stubs en el PATH, el «usuario del
 * servicio» es `env` (no hay `runuser` sin root) y todas las rutas de root son temporales. El
 * verificador es el REAL (`src/system/verify-update.ts` empaquetado con una clave de prueba).
 */
const AGENT = fileURLToPath(new URL('../..', import.meta.url));
const SCRIPT = join(AGENT, 'scripts', 'krakenos-helper.sh');
const PEM = (k: KeyObject) => k.export({ type: 'spki', format: 'pem' }).toString();

const good = generateKeyPairSync('ed25519');
let base: string; // compartido: stubs + verificador
let verifier: string;
let w: string; // por test
let staging: string;
let rootDir: string;
let data: string;
let stub: string;

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'kraken-pkg-base-')));
  const entry = join(base, 'entry.ts');
  writeFileSync(
    entry,
    `import { runVerifyCli } from ${JSON.stringify(join(AGENT, 'src/system/verify-update.ts'))};\n` +
      `process.exitCode = await runVerifyCli(process.argv.slice(2), ${JSON.stringify(PEM(good.publicKey))}, (l) => process.stderr.write(l + '\\n'));\n`,
  );
  const tsup = createRequire(join(AGENT, 'package.json')).resolve('tsup/dist/cli-default.js');
  execFileSync(
    process.execPath,
    [
      tsup,
      entry,
      '--no-config',
      '--format',
      'esm',
      '--platform',
      'node',
      '--target',
      'node24',
    ].concat(['--out-dir', join(base, 'out')]),
    { cwd: AGENT, stdio: 'pipe' },
  );
  verifier = join(base, 'out', 'entry.js');
  const bin = join(base, 'bin');
  mkdirSync(bin);
  // Los stubs leen/escriben en $STUB (por test): versión instalada, registro de llamadas, fallos.
  const put = (n: string, body: string) => {
    writeFileSync(join(bin, n), `#!/usr/bin/env bash\n${body}\n`);
    chmodSync(join(bin, n), 0o755);
  };
  put('dpkg-query', 'cat "$STUB/installed"');
  put('dpkg', 'echo amd64');
  put(
    'systemctl',
    'echo "systemctl $*" >> "$STUB/log"; [ -e "$STUB/systemctl-fail" ] && exit 1; exit 0',
  );
  // apt-get deja constancia de QUÉ fichero instala y de su suma EN ESE MOMENTO; `$STUB/mutate`
  // simula al servicio cambiando su fichero justo antes de que root instale.
  put(
    'apt-get',
    [
      'f="${@: -1}"',
      '[ -e "$STUB/mutate" ] && echo malo > "$(cat "$STUB/mutate")"',
      'echo "apt-get $* sha=$(sha256sum "$f" | cut -d" " -f1)" >> "$STUB/log"',
      '[ -e "$STUB/apt-fail" ] && exit 100',
      'exit 0',
    ].join('\n'),
  );
}, 60_000);
afterAll(() => rmSync(base, { recursive: true, force: true }));

beforeEach(() => {
  w = realpathSync(mkdtempSync(join(tmpdir(), 'kraken-pkg-')));
  staging = join((data = join(w, 'data')), 'updates');
  mkdirSync(staging, { recursive: true });
  rootDir = join(w, 'rootvar', 'updates');
  stub = join(w, 'stub');
  mkdirSync(stub);
  writeFileSync(join(stub, 'installed'), '0.2.0');
});
afterEach(() => rmSync(w, { recursive: true, force: true }));

const pkgName = (v: string) => `krakenos_${v}_amd64.deb`;

/** Un release firmado en el staging del servicio (el agente ya lo verificó). */
function release(
  v: string,
  o: { key?: ReturnType<typeof generateKeyPairSync>; content?: string; minFrom?: string } = {},
) {
  const content = Buffer.from(o.content ?? `paquete ${v}`);
  const manifest = Buffer.from(
    JSON.stringify({
      schema: 1,
      version: v,
      minFrom: o.minFrom ?? '0.1.0',
      artifacts: [
        {
          platform: 'deb-amd64',
          name: pkgName(v),
          sha256: createHash('sha256').update(content).digest('hex'),
          size: content.length,
        },
      ],
    }),
  );
  writeFileSync(join(staging, pkgName(v)), content);
  writeFileSync(join(staging, 'manifest.json'), manifest);
  writeFileSync(
    join(staging, 'manifest.json.sig'),
    sign(null, manifest, (o.key ?? good).privateKey).toString('base64'),
  );
  return {
    pkg: join(staging, pkgName(v)),
    man: join(staging, 'manifest.json'),
    sig: join(staging, 'manifest.json.sig'),
    sha: createHash('sha256').update(content).digest('hex'),
  };
}

function run(args: string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<{ code: number; stderr: string }>((resolve) => {
    execFile(
      'bash',
      [SCRIPT, ...args],
      {
        env: {
          ...process.env,
          PATH: `${join(base, 'bin')}:${process.env.PATH}`,
          STUB: stub,
          KRAKENOS_HELPER_CONF: '/dev/null/none',
          KRAKENOS_PKG_DATA_DIR: data,
          KRAKENOS_PKG_STAGING: staging,
          KRAKENOS_PKG_ROOT_DIR: rootDir,
          KRAKENOS_PKG_NODE: process.execPath,
          KRAKENOS_PKG_VERIFIER: verifier,
          KRAKENOS_PKG_RUN_AS: 'env',
          KRAKENOS_PKG_FORMAT: 'deb',
          ...env,
        },
      },
      (err, _o, stderr) => {
        const c = (err as { code?: unknown } | null)?.code;
        resolve({ code: err ? (typeof c === 'number' ? c : 1) : 0, stderr });
      },
    );
  });
}

const update = (r: { pkg: string; man: string; sig: string }, v: string, env?: NodeJS.ProcessEnv) =>
  run(['pkg-update', r.pkg, r.man, r.sig, v], env);
const log = () => (existsSync(join(stub, 'log')) ? readFileSync(join(stub, 'log'), 'utf8') : '');
const aptCalls = () =>
  log()
    .split('\n')
    .filter((l) => l.startsWith('apt-get'));

describe.skipIf(process.platform === 'win32')(
  'krakenos-helper pkg-update (root re-verifica)',
  () => {
    it('instala desde SU copia (no desde el staging), la conserva y guarda el estado de rollback', async () => {
      const r = release('0.3.0');
      const res = await update(r, '0.3.0');
      expect(res.code, res.stderr).toBe(0);
      const [call] = aptCalls();
      expect(call).toContain(`${rootDir}/0.3.0/${pkgName('0.3.0')}`);
      expect(call).not.toContain(staging);
      expect(call).toContain('-y');
      expect(readFileSync(join(rootDir, '0.3.0', pkgName('0.3.0')), 'utf8')).toBe('paquete 0.3.0');
      expect(readFileSync(join(rootDir, '.state'), 'utf8')).toBe('prev=\n');
      expect(log()).not.toContain('systemctl');
    });

    it('el servicio cambia el paquete justo antes de instalar: root instala SU copia verificada', async () => {
      const r = release('0.3.0');
      writeFileSync(join(stub, 'mutate'), r.pkg);
      const res = await update(r, '0.3.0');
      expect(res.code, res.stderr).toBe(0);
      expect(readFileSync(r.pkg, 'utf8')).toBe('malo\n'); // el staging SÍ cambió...
      expect(aptCalls()[0]).toContain(`sha=${r.sha}`); // ...y lo instalado es lo verificado
    });

    it('un paquete cambiado tras la verificación del agente (mismo manifiesto) se rechaza (65) sin instalar', async () => {
      const r = release('0.3.0');
      writeFileSync(r.pkg, 'paquete 0.3.X'); // misma longitud, otro contenido
      const res = await update(r, '0.3.0');
      expect(res.code).toBe(65);
      expect(res.stderr).toMatch(/suma/);
      expect(aptCalls()).toEqual([]);
      expect(existsSync(join(rootDir, '0.3.0'))).toBe(false);
    });

    it('un manifiesto firmado con otra clave se rechaza (65)', async () => {
      const res = await update(release('0.3.0', { key: generateKeyPairSync('ed25519') }), '0.3.0');
      expect(res.code).toBe(65);
      expect(aptCalls()).toEqual([]);
    });

    it('un downgrade o la misma versión se rechaza aunque la firma sea válida (instalada = la de dpkg-query)', async () => {
      for (const inst of ['0.3.0', '0.4.0']) {
        writeFileSync(join(stub, 'installed'), inst);
        const res = await update(release('0.3.0'), '0.3.0');
        expect(res.code, inst).toBe(65);
      }
      expect(aptCalls()).toEqual([]);
    });

    it('una versión instalada que no se puede leer se rechaza (no se adivina)', async () => {
      writeFileSync(join(stub, 'installed'), '');
      expect((await update(release('0.3.0'), '0.3.0')).code).toBe(64);
      expect(aptCalls()).toEqual([]);
    });

    it('un enlace simbólico en lugar del paquete se rechaza (64)', async () => {
      const r = release('0.3.0');
      writeFileSync(join(w, 'secreto'), 'paquete 0.3.0');
      rmSync(r.pkg);
      symlinkSync(join(w, 'secreto'), r.pkg);
      const res = await update(r, '0.3.0');
      expect(res.code).toBe(64);
      expect(res.stderr).toMatch(/enlace/);
      expect(aptCalls()).toEqual([]);
    });

    it('un directorio del staging que es un enlace se rechaza (64)', async () => {
      const r = release('0.3.0');
      const real = join(w, 'otro');
      mkdirSync(real);
      for (const f of readdirSync(staging))
        writeFileSync(join(real, f), readFileSync(join(staging, f)));
      rmSync(staging, { recursive: true });
      symlinkSync(real, staging);
      expect((await update(r, '0.3.0')).code).toBe(64);
      expect(aptCalls()).toEqual([]);
    });

    it('rutas fuera del staging (otro directorio, subdirectorio, relativa, con ..) se rechazan (64)', async () => {
      const r = release('0.3.0');
      const fuera = join(w, 'fuera');
      mkdirSync(fuera);
      mkdirSync(join(staging, 'sub'));
      writeFileSync(join(fuera, pkgName('0.3.0')), 'paquete 0.3.0');
      writeFileSync(join(staging, 'sub', pkgName('0.3.0')), 'paquete 0.3.0');
      for (const pkg of [
        join(fuera, pkgName('0.3.0')),
        join(staging, 'sub', pkgName('0.3.0')),
        `${staging}/../updates/${pkgName('0.3.0')}`,
        pkgName('0.3.0'),
      ]) {
        expect((await run(['pkg-update', pkg, r.man, r.sig, '0.3.0'])).code, pkg).toBe(64);
      }
      expect(aptCalls()).toEqual([]);
    });

    it('versiones y nombres mal formados se rechazan (64)', async () => {
      const r = release('0.3.0');
      for (const v of ['0.3', '0.3.0-rc1', '../0.3.0', '0.3.0 ', 'v0.3.0', '']) {
        expect((await update(r, v)).code, v).toBe(64);
      }
      writeFileSync(join(staging, 'raro name.deb'), 'x');
      expect(
        (await run(['pkg-update', join(staging, 'raro name.deb'), r.man, r.sig, '0.3.0'])).code,
      ).toBe(64);
      writeFileSync(join(staging, 'manifiesto.json'), 'x');
      expect(
        (await run(['pkg-update', r.pkg, join(staging, 'manifiesto.json'), r.sig, '0.3.0'])).code,
      ).toBe(64);
      expect((await run(['pkg-update', r.pkg, r.man, r.sig])).code).toBe(64);
      expect(aptCalls()).toEqual([]);
    });

    it('un directorio de root que no es de root 0700 se rechaza (64)', async () => {
      mkdirSync(rootDir, { recursive: true, mode: 0o755 });
      chmodSync(rootDir, 0o755);
      expect((await update(release('0.3.0'), '0.3.0')).code).toBe(64);
      expect(aptCalls()).toEqual([]);
    });

    it('si apt-get falla, sale con su código y deja el estado para el rollback', async () => {
      writeFileSync(join(stub, 'apt-fail'), '');
      const res = await update(release('0.3.0'), '0.3.0');
      expect(res.code).toBe(100);
      expect(existsSync(join(rootDir, '.state'))).toBe(true);
    });

    it('una actualización rechazada borra el estado: un rollback posterior no reinstala nada', async () => {
      expect((await update(release('0.3.0'), '0.3.0')).code).toBe(0);
      writeFileSync(join(stub, 'installed'), '0.3.0');
      expect((await update(release('0.4.0', { content: 'x' }), '0.4.0', {})).code).toBe(0);
      // ahora un intento rechazado (firma de otra clave)
      writeFileSync(join(stub, 'installed'), '0.4.0');
      expect(
        (await update(release('0.5.0', { key: generateKeyPairSync('ed25519') }), '0.5.0')).code,
      ).toBe(65);
      expect(existsSync(join(rootDir, '.state'))).toBe(false);
    });

    it('conserva solo la versión nueva y la anterior', async () => {
      for (const [inst, v] of [
        ['0.1.0', '0.2.0'],
        ['0.2.0', '0.3.0'],
        ['0.3.0', '0.4.0'],
      ] as const) {
        writeFileSync(join(stub, 'installed'), inst);
        expect((await update(release(v), v)).code).toBe(0);
      }
      expect(
        readdirSync(rootDir)
          .filter((n) => !n.startsWith('.'))
          .sort(),
      ).toEqual(['0.3.0', '0.4.0']);
      expect(readFileSync(join(rootDir, '.state'), 'utf8')).toBe('prev=0.3.0\n');
    });
  },
);

describe.skipIf(process.platform === 'win32')('krakenos-helper pkg-rollback', () => {
  let db: string;
  let copy: string;
  beforeEach(() => {
    mkdirSync(join(data, 'prisma'), { recursive: true });
    db = join(data, 'prisma', 'krakenos.db');
    copy = `${db}.pre-update`;
    writeFileSync(db, 'base nueva');
    writeFileSync(`${db}-wal`, 'wal');
    writeFileSync(`${db}-shm`, 'shm');
    writeFileSync(copy, 'base de antes');
  });
  const rollback = (c = copy) => run(['pkg-rollback', c]);

  /** Dos actualizaciones seguidas: la segunda guarda la primera como paquete anterior. */
  async function dosActualizaciones() {
    writeFileSync(join(stub, 'installed'), '0.1.0');
    expect((await update(release('0.2.0'), '0.2.0')).code).toBe(0);
    writeFileSync(join(stub, 'installed'), '0.2.0');
    expect((await update(release('0.3.0'), '0.3.0')).code).toBe(0);
    writeFileSync(join(stub, 'log'), '');
  }

  it('con paquete anterior: para el servicio, reinstala SU copia verificada, restaura la base y arranca', async () => {
    await dosActualizaciones();
    writeFileSync(join(stub, 'installed'), '0.3.0');
    const res = await rollback();
    expect(res.code, res.stderr).toBe(0);
    const l = log().trim().split('\n');
    expect(l[0]).toBe('systemctl stop krakenos');
    expect(l[1]).toContain('--allow-downgrades');
    expect(l[1]).toContain(`${rootDir}/0.2.0/${pkgName('0.2.0')}`);
    expect(l[2]).toBe('systemctl start krakenos');
    expect(readFileSync(db, 'utf8')).toBe('base de antes');
    expect(existsSync(`${db}-wal`)).toBe(false);
    expect(existsSync(`${db}-shm`)).toBe(false);
    expect(existsSync(join(rootDir, '.state'))).toBe(false);
  });

  it('el paquete anterior de root alterado ya no verifica: no se reinstala y falla', async () => {
    await dosActualizaciones();
    writeFileSync(join(rootDir, '0.2.0', pkgName('0.2.0')), 'otro contenido!');
    const res = await rollback();
    expect(res.code).toBe(1);
    expect(aptCalls()).toEqual([]);
    expect(readFileSync(db, 'utf8')).toBe('base de antes'); // la base sí se restaura
  });

  it('primera actualización por paquete: restaura la base, arranca y dice claro que no hay anterior (66)', async () => {
    expect((await update(release('0.3.0'), '0.3.0')).code).toBe(0);
    writeFileSync(join(stub, 'log'), '');
    const res = await rollback();
    expect(res.code).toBe(66);
    expect(res.stderr).toMatch(/no hay paquete anterior/);
    expect(aptCalls()).toEqual([]);
    expect(log()).toBe('systemctl stop krakenos\nsystemctl start krakenos\n');
    expect(readFileSync(db, 'utf8')).toBe('base de antes');
  });

  it('sin una instalación en curso no toca nada (ni para el servicio ni restaura la base)', async () => {
    const res = await rollback();
    expect(res.code).toBe(0);
    expect(log()).toBe('');
    expect(readFileSync(db, 'utf8')).toBe('base nueva');
  });

  it('un estado caducado se ignora: el agente no puede forzar un downgrade días después', async () => {
    await dosActualizaciones();
    const viejo = new Date(Date.now() - 3 * 3600_000);
    utimesSync(join(rootDir, '.state'), viejo, viejo);
    const res = await rollback();
    expect(res.code).toBe(0);
    expect(log()).toBe('');
  });

  it('si el servicio no se puede parar, no toca la base', async () => {
    await dosActualizaciones();
    writeFileSync(join(stub, 'systemctl-fail'), '');
    const res = await rollback();
    expect(res.code).toBe(1);
    expect(readFileSync(db, 'utf8')).toBe('base nueva');
    expect(aptCalls()).toEqual([]);
  });

  it('rechaza copias fuera de los datos, enlaces, sin sufijo y rutas con ..', async () => {
    await dosActualizaciones();
    const fuera = join(w, 'fuera.db.pre-update');
    writeFileSync(fuera, 'x');
    const enlace = join(data, 'prisma', 'otra.db.pre-update');
    symlinkSync(fuera, enlace);
    const sinSufijo = join(data, 'prisma', 'krakenos.copia');
    writeFileSync(sinSufijo, 'x');
    for (const c of [
      fuera,
      enlace,
      sinSufijo,
      `${data}/prisma/../prisma/krakenos.db.pre-update`,
      'krakenos.db.pre-update',
    ]) {
      expect((await rollback(c)).code, c).toBe(64);
    }
    expect(log()).toBe('');
  });

  it('rechaza una base que es un enlace simbólico (root no la sobrescribiría a través del enlace)', async () => {
    await dosActualizaciones();
    rmSync(db);
    symlinkSync(join(w, 'secreto'), db);
    expect((await rollback()).code).toBe(64);
    expect(log()).toBe('');
  });
});
