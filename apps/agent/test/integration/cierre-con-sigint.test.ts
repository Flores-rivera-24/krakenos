import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { generateJwtKeys, keyPathsFromDir } from '../../src/crypto/keys.js';
import { shutdownSignals } from '../../src/system/shutdown.js';

/**
 * El cierre con una señal real (US-280).
 *
 * `shutdown.test.ts` prueba el cierre con un `app` de mentira. Aquí se arranca el AGENTE
 * de verdad como proceso hijo —con `KRAKENOS_DATA_DIR`/`KRAKENOS_APP_DIR` apuntando a un
 * directorio temporal, nunca a la base de desarrollo—, se le manda `SIGINT` y se comprueba
 * lo que importa: sale con 0 y el WAL de SQLite queda volcado (sin `-wal` con contenido),
 * que es lo que evita perder escrituras al parar el servicio.
 *
 * Windows no entrega `SIGINT` a un hijo con `kill()`: ahí lo cubre la CI de Windows con su
 * lista de saltos (el cierre por Ctrl+C se comprueba a mano en la primera sesión real).
 */

const AGENT_DIR = fileURLToPath(new URL('../..', import.meta.url));
const TSX_CLI = fileURLToPath(new URL('../../node_modules/tsx/dist/cli.mjs', import.meta.url));

function puertoLibre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
  });
}

async function esperarListo(port: number, hijo: ChildProcess, salida: () => string): Promise<void> {
  const limite = Date.now() + 45_000;
  while (Date.now() < limite) {
    if (hijo.exitCode !== null) {
      throw new Error(`El agente salió antes de estar listo (${hijo.exitCode}):\n${salida()}`);
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health/ready`);
      if (res.ok) return;
    } catch {
      // aún no escucha
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`El agente no llegó a estar listo en 45 s:\n${salida()}`);
}

describe('señales de cierre por plataforma', () => {
  it('en Linux y macOS: SIGINT y SIGTERM', () => {
    expect(shutdownSignals('linux')).toEqual(['SIGINT', 'SIGTERM']);
    expect(shutdownSignals('darwin')).toEqual(['SIGINT', 'SIGTERM']);
  });

  it('en Windows se añade SIGBREAK (cierre de consola)', () => {
    expect(shutdownSignals('win32')).toEqual(['SIGINT', 'SIGTERM', 'SIGBREAK']);
  });
});

describe.skipIf(process.platform === 'win32')('cierre con SIGINT del agente real', () => {
  let tmp: string | undefined;
  let hijo: ChildProcess | undefined;

  afterEach(() => {
    if (hijo && hijo.exitCode === null) hijo.kill('SIGKILL');
    if (tmp) rmSync(tmp, { recursive: true, force: true });
    tmp = undefined;
    hijo = undefined;
  });

  it('sale con 0 y deja el WAL volcado', { timeout: 90_000 }, async () => {
    tmp = mkdtempSync(join(tmpdir(), 'krakenos-sigint-'));
    const estado = join(tmp, 'estado');
    mkdirSync(join(estado, 'prisma'), { recursive: true });
    const keys = keyPathsFromDir(join(estado, 'keys'));
    generateJwtKeys(keys);
    const port = await puertoLibre();

    // Entorno MÍNIMO y explícito: nada del de los tests (su DATABASE_URL, NODE_ENV…).
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: tmp,
      NODE_ENV: 'production',
      PORT: String(port),
      HOST: '127.0.0.1',
      SERVE_WEB: 'false',
      DRIVER_KIND: 'mock',
      WEB_ORIGIN: 'http://localhost:5173',
      KRAKENOS_DATA_DIR: estado,
      KRAKENOS_APP_DIR: AGENT_DIR,
      DATABASE_URL: 'file:./sigint.db', // relativa: cuelga de <KRAKENOS_DATA_DIR>/prisma
      JWT_PRIVATE_KEY_PATH: keys.privatePath,
      JWT_PUBLIC_KEY_PATH: keys.publicPath,
    };
    let salida = '';
    // El cwd es el directorio temporal, NO apps/agent: lo que se prueba es que el agente
    // ya no supone dónde arranca.
    hijo = spawn(process.execPath, [TSX_CLI, join(AGENT_DIR, 'src/index.ts')], {
      cwd: tmp,
      env,
      windowsHide: true,
    });
    hijo.stdout?.on('data', (d: Buffer) => (salida += d.toString()));
    hijo.stderr?.on('data', (d: Buffer) => (salida += d.toString()));
    const salio = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
      hijo!.once('exit', (code, signal) => resolve({ code, signal })),
    );

    await esperarListo(port, hijo, () => salida);

    const db = join(estado, 'prisma', 'sigint.db');
    const wal = `${db}-wal`;
    expect(existsSync(db), 'la base vive bajo KRAKENOS_DATA_DIR').toBe(true);
    // Precondición: el WAL tiene contenido sin volcar. Si no, el test no probaría nada.
    expect(existsSync(wal) && statSync(wal).size > 0, 'WAL con contenido antes de cerrar').toBe(
      true,
    );

    hijo.kill('SIGINT');
    const { code, signal } = await salio;

    expect({ code, signal }, salida).toEqual({ code: 0, signal: null });
    const walTrasCerrar = existsSync(wal) ? statSync(wal).size : 0;
    expect(walTrasCerrar, 'sin -wal con contenido tras salir').toBe(0);
  });
});
