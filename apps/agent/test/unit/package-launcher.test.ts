import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// prettier-ignore
// @ts-expect-error — script de utilidad en JS puro (fuera del tsconfig del agente).
import { ensureEnv, withKindsNone } from '../../../../scripts/package/launchers/first-run.mjs';

/**
 * Lanzadores del paquete autocontenido (US-284, Tarea 3).
 *
 * Se monta un paquete FALSO en un directorio con un espacio en la ruta (`C:\Program Files`,
 * `~/Mis cosas`): el `node` es una copia del que corre el test, y `index.js`/`keys.js` solo
 * registran con qué cwd y entorno se les llamó. Lo real (migraciones, arranque) lo prueba el smoke.
 * HOME/XDG_DATA_HOME/LOCALAPPDATA van a un temporal: nunca al perfil real.
 */

const LAUNCHERS = fileURLToPath(new URL('../../../../scripts/package/launchers/', import.meta.url));
const WIN = process.platform === 'win32';

const ENV_EXAMPLE = [
  'PORT=3001',
  'DRIVER_KIND=mock',
  'VPN_KIND=mock',
  'IOT_KIND=mock',
  'CAMERAS_KIND=mock',
  'FIREWALL_KIND=mock',
  'VLAN_KIND=mock',
  'QOS_KIND=mock',
  'DNS_KIND=mock',
  '',
].join('\n');

const INDEX_JS = `
const fs = require('node:fs');
const path = require('node:path');
fs.writeFileSync(path.join(process.env.RECORD_DIR, 'index.json'), JSON.stringify({
  cwd: process.cwd(), argv: process.argv.slice(2),
  env: ['KRAKENOS_APP_DIR','KRAKENOS_DATA_DIR','KRAKENOS_DEPLOY_MODE','NODE_ENV']
    .reduce((a, k) => ({ ...a, [k]: process.env[k] }), {}),
}));
process.exit(7);
`;

const KEYS_JS = `
const fs = require('node:fs');
const path = require('node:path');
fs.appendFileSync(path.join(process.env.RECORD_DIR, 'keys-calls.log'), process.argv.slice(2).join(' ') + '\\n');
fs.mkdirSync('keys', { recursive: true });
fs.writeFileSync(path.join('keys', 'jwt-private.pem'), 'x');
`;

let raiz: string;
let pkg: string;
let datos: string;
let registro: string;

function montarPaquete(): void {
  const nodeBin = WIN ? 'node/node.exe' : 'node/bin/node';
  mkdirSync(join(pkg, 'app', 'agent', 'dist'), { recursive: true });
  mkdirSync(join(pkg, nodeBin, '..'), { recursive: true });
  copyFileSync(process.execPath, join(pkg, nodeBin));
  writeFileSync(join(pkg, 'app', 'agent', 'dist', 'index.js'), INDEX_JS);
  writeFileSync(join(pkg, 'app', 'agent', 'dist', 'keys.js'), KEYS_JS);
  writeFileSync(join(pkg, 'app', 'agent', '.env.example'), ENV_EXAMPLE);
  copyFileSync(join(LAUNCHERS, 'first-run.mjs'), join(pkg, 'app', 'first-run.mjs'));
  copyFileSync(join(LAUNCHERS, '..', 'relink.mjs'), join(pkg, 'app', 'relink.mjs'));
  if (WIN) {
    copyFileSync(join(LAUNCHERS, 'krakenos.cmd'), join(pkg, 'krakenos.cmd'));
  } else {
    mkdirSync(join(pkg, 'bin'));
    copyFileSync(join(LAUNCHERS, 'krakenos'), join(pkg, 'bin', 'krakenos'));
    chmodSync(join(pkg, 'bin', 'krakenos'), 0o755);
  }
}

function lanzar(extra: Record<string, string> = {}, paquete = pkg) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: join(raiz, 'home'),
    XDG_DATA_HOME: join(raiz, 'xdg'),
    LOCALAPPDATA: join(raiz, 'localappdata'),
    RECORD_DIR: registro,
    ...extra,
  };
  delete env.KRAKENOS_DATA_DIR;
  delete env.KRAKENOS_DEPLOY_MODE;
  Object.assign(env, extra);
  if (WIN) {
    return spawnSync('cmd.exe', ['/d', '/s', '/c', `""${join(pkg, 'krakenos.cmd')}""`], {
      env,
      windowsVerbatimArguments: true,
      encoding: 'utf8',
    });
  }
  return spawnSync(join(paquete, 'bin', 'krakenos'), [], { env, encoding: 'utf8' });
}

const leerIndex = () => JSON.parse(readFileSync(join(registro, 'index.json'), 'utf8'));
const llamadasKeys = () => {
  const f = join(registro, 'keys-calls.log');
  return existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n') : [];
};

beforeEach(() => {
  raiz = mkdtempSync(join(tmpdir(), 'kraken lanzador '));
  pkg = join(raiz, 'Mis cosas', 'krakenos-0.0.0-test');
  registro = join(raiz, 'registro');
  mkdirSync(registro);
  mkdirSync(pkg, { recursive: true });
  montarPaquete();
});
afterEach(() => rmSync(raiz, { recursive: true, force: true }));

describe('first-run.mjs (puro)', () => {
  it('pone los ocho *_KIND a none y conserva el resto', () => {
    const out = withKindsNone(ENV_EXAMPLE);
    expect(out.match(/^\w+_KIND=none$/gm)).toHaveLength(8);
    expect(out).not.toContain('mock');
    expect(out).toContain('PORT=3001');
  });

  it('con la plantilla REAL de apps/agent/.env.example deja exactamente ocho *_KIND=none y ningún mock', () => {
    const real = readFileSync(
      join(LAUNCHERS, '..', '..', '..', 'apps', 'agent', '.env.example'),
      'utf8',
    );
    const out = withKindsNone(real);
    expect(out.match(/^\w+_KIND=none$/gm)).toHaveLength(8);
    expect(out).not.toMatch(/^\w+_KIND=mock$/m);
  });

  it('no toca un .env que ya existe', () => {
    writeFileSync(join(raiz, '.env'), 'PORT=4999\n');
    writeFileSync(join(raiz, 'plantilla'), ENV_EXAMPLE);
    expect(ensureEnv(raiz, join(raiz, 'plantilla'))).toBe(false);
    expect(readFileSync(join(raiz, '.env'), 'utf8')).toBe('PORT=4999\n');
  });
});

// El .cmd solo se ejecuta en Windows y el sh solo fuera: cada uno necesita su intérprete.
describe.runIf(WIN)('krakenos.cmd (Windows)', () => {
  // Las rutas pueden llegar en forma corta (RUNNER~1) por un lado y larga por el otro.
  const real = (p: string) => realpathSync.native(p).toLowerCase();

  it('sin variables: modo package, producción, cwd = %LOCALAPPDATA%\\KrakenOS, y el código de salida', () => {
    const r = lanzar();
    expect(r.status).toBe(7);
    const idx = leerIndex();
    const datosPorDefecto = join(raiz, 'localappdata', 'KrakenOS');
    expect(idx.env.KRAKENOS_DEPLOY_MODE).toBe('package');
    expect(idx.env.NODE_ENV).toBe('production');
    expect(real(idx.env.KRAKENOS_APP_DIR)).toBe(real(join(pkg, 'app', 'agent')));
    expect(real(idx.env.KRAKENOS_DATA_DIR)).toBe(real(datosPorDefecto));
    expect(real(idx.cwd)).toBe(real(datosPorDefecto));
    expect(existsSync(datosPorDefecto)).toBe(true);
  });

  it('respeta KRAKENOS_DATA_DIR y KRAKENOS_DEPLOY_MODE del entorno', () => {
    datos = join(raiz, 'mis datos');
    lanzar({ KRAKENOS_DATA_DIR: datos, KRAKENOS_DEPLOY_MODE: 'docker' });
    const idx = leerIndex();
    expect(idx.env.KRAKENOS_DATA_DIR).toBe(datos);
    expect(idx.env.KRAKENOS_DEPLOY_MODE).toBe('docker');
    expect(real(idx.cwd)).toBe(real(datos));
  });

  it('primer arranque: genera claves y .env; el segundo no toca ninguno', () => {
    datos = join(raiz, 'mis datos');
    lanzar({ KRAKENOS_DATA_DIR: datos });
    expect(llamadasKeys()).toEqual(['gen']);
    const env1 = readFileSync(join(datos, '.env'), 'utf8');
    expect(env1.match(/^\w+_KIND=none$/gm)).toHaveLength(8);

    writeFileSync(join(datos, '.env'), 'PORT=4999\n');
    lanzar({ KRAKENOS_DATA_DIR: datos });
    expect(llamadasKeys()).toEqual(['gen']);
    expect(readFileSync(join(datos, '.env'), 'utf8')).toBe('PORT=4999\n');
  });
});

describe.skipIf(WIN)('bin/krakenos (Linux)', () => {
  it('con el paquete bajo un enlace simbólico, el primer arranque crea .env y claves', () => {
    // Node resuelve el enlace en import.meta.url pero no en argv[1], y el lanzador conserva el enlace.
    symlinkSync(join(raiz, 'Mis cosas'), join(raiz, 'enlace'));
    datos = join(raiz, 'mis datos');
    const r = lanzar({ KRAKENOS_DATA_DIR: datos }, join(raiz, 'enlace', 'krakenos-0.0.0-test'));
    expect(r.status).toBe(7);
    expect(existsSync(join(datos, '.env'))).toBe(true);
    expect(existsSync(join(datos, 'keys', 'jwt-private.pem'))).toBe(true);
  });

  it('sin variables: modo package, producción, cwd = datos, y el código de salida de index.js', () => {
    const r = lanzar();
    expect(r.status).toBe(7);
    const idx = leerIndex();
    const datosPorDefecto = join(raiz, 'xdg', 'krakenos');
    expect(idx.env.KRAKENOS_DEPLOY_MODE).toBe('package');
    expect(idx.env.NODE_ENV).toBe('production');
    expect(idx.env.KRAKENOS_APP_DIR).toBe(join(pkg, 'app', 'agent'));
    expect(idx.env.KRAKENOS_DATA_DIR).toBe(datosPorDefecto);
    expect(idx.cwd).toBe(datosPorDefecto);
    expect(existsSync(datosPorDefecto)).toBe(true);
  });

  it('sin XDG_DATA_HOME usa ~/.local/share/krakenos', () => {
    const r = lanzar({ XDG_DATA_HOME: '' });
    expect(r.status).toBe(7);
    expect(leerIndex().env.KRAKENOS_DATA_DIR).toBe(
      join(raiz, 'home', '.local', 'share', 'krakenos'),
    );
  });

  it('respeta KRAKENOS_DATA_DIR y KRAKENOS_DEPLOY_MODE del entorno', () => {
    datos = join(raiz, 'mis datos');
    lanzar({ KRAKENOS_DATA_DIR: datos, KRAKENOS_DEPLOY_MODE: 'docker' });
    const idx = leerIndex();
    expect(idx.env.KRAKENOS_DATA_DIR).toBe(datos);
    expect(idx.env.KRAKENOS_DEPLOY_MODE).toBe('docker');
    expect(idx.cwd).toBe(datos);
  });

  it('primer arranque: genera claves y .env; el segundo no toca ninguno', () => {
    datos = join(raiz, 'mis datos');
    lanzar({ KRAKENOS_DATA_DIR: datos });
    expect(llamadasKeys()).toEqual(['gen']);
    const env1 = readFileSync(join(datos, '.env'), 'utf8');
    expect(env1.match(/^\w+_KIND=none$/gm)).toHaveLength(8);

    writeFileSync(join(datos, '.env'), 'PORT=4999\n');
    lanzar({ KRAKENOS_DATA_DIR: datos });
    expect(llamadasKeys()).toEqual(['gen']);
    expect(readFileSync(join(datos, '.env'), 'utf8')).toBe('PORT=4999\n');
  });
});
