import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { puertoOcupado, quienTieneElPuerto } from '../../lib/server.js';

/**
 * Arnés de los **stacks reales** (`pnpm dev` y `pnpm prod`).
 *
 * La suite e2e de US-189 (`e2e/playwright.config.ts`) corre contra un montaje
 * **propio**: `dist/index.js` con `NODE_ENV=test`, `SERVE_WEB=true` y un puerto
 * fijo. Es determinista, pero por eso mismo **no ejerce ninguno de los dos
 * montajes que usa una persona de verdad**:
 *
 *  · `pnpm dev`  → Vite en :5173 **proxeando** `/api`, `/health` y `/socket.io`
 *    al agente en :3001. Dos orígenes, HMR, React en modo desarrollo
 *    (StrictMode monta los efectos dos veces) y el service worker registrándose
 *    sobre los módulos sin empaquetar de Vite.
 *  · `pnpm prod` → `NODE_ENV=production` sirviendo API + UI construida en **un
 *    solo puerto**. Logs JSON, assets con hash, cookie de sesión evaluando
 *    `secure` con la config real.
 *
 * Las diferencias entre esos dos y el arnés de US-189 son exactamente donde
 * viven los fallos de flujo que ninguna suite veía. Este módulo levanta ambos a
 * la vez (puertos distintos, bases de datos distintas) para poder correr los
 * mismos flujos contra los dos y comparar.
 *
 * ⚠️ No sustituye a `e2e/playwright.config.ts`: aquel es el gate de CI (rápido y
 * determinista); este es el arnés de **verificación de montaje**, más lento
 * porque arranca Vite y hace un build.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../../..');
const AGENT_DIR = resolve(ROOT, 'apps/agent');
const WEB_DIR = resolve(ROOT, 'apps/web');
const STATE_FILE = resolve(HERE, '../.stacks-state.json');

/** Los dos montajes bajo prueba. El nombre es también el del proyecto Playwright. */
export type StackName = 'dev' | 'prod';

/**
 * Puertos fijos y distintos de los del arnés de US-189 (:3999) para poder correr
 * ambas suites a la vez sin pisarse. `dev` usa los puertos **reales** del
 * proyecto (:3001 agente, :5173 Vite) porque el proxy de `vite.config.ts` apunta
 * a `localhost:3001` por defecto y queremos ejercer esa configuración tal cual.
 */
export const PORTS = { devAgent: 3001, devWeb: 5173, prod: 3002 } as const;

export const BASE_URL: Record<StackName, string> = {
  // Origen del **navegador**: en dev es Vite, que proxea al agente.
  dev: `http://localhost:${PORTS.devWeb}`,
  prod: `http://localhost:${PORTS.prod}`,
};

/**
 * Rutas **absolutas** de las DB de cada stack. Absolutas a propósito: Prisma
 * resuelve los `file:` relativos respecto al directorio del schema, no al cwd
 * (misma razón que en `e2e/lib/server.ts`).
 */
function dbFile(stack: StackName): string {
  return resolve(AGENT_DIR, `prisma/stack-${stack}.db`);
}

export interface StacksState {
  /** Token de configuración out-of-band impreso por cada agente al arrancar. */
  setupToken: Record<StackName, string>;
  /**
   * PID de cada proceso lanzado. Se persisten además de guardarlos en memoria
   * porque el teardown debe poder matar los árboles aunque el proceso de
   * Playwright que arrancó los stacks ya no sea el mismo (tanda interrumpida).
   */
  pids: number[];
}

export function readStacksState(): StacksState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as StacksState;
}

/** Procesos vivos, para el teardown. */
const running: ChildProcess[] = [];

/**
 * Qué `*_KIND` lleva cada stack. Son DOS montajes con dos entornos distintos, a propósito:
 *
 *  · `prod` lleva el `.env` que escribe `scripts/install.sh` en una instalación real: los ocho
 *    dominios SIN CONFIGURAR (`none`). Es la primera pantalla que ve quien acaba de instalar, y
 *    el montaje donde se comprueba que **no enseña ningún dato inventado** ni emite alertas.
 *  · `dev` sigue en `mock` (demostración): es lo que ve quien desarrolla o prueba la imagen
 *    Docker, y donde se comprueba que la app **lo declara** («Datos de demostración»).
 *
 * `e2e/stacks/specs/sin-datos-inventados.spec.ts` ata esta diferencia.
 */
export const KIND_DEL_STACK: Record<StackName, 'none' | 'mock'> = { dev: 'mock', prod: 'none' };

/**
 * Entorno común: sin hardware (todos los dominios en el `KIND_DEL_STACK` del montaje) y claves
 * JWT explícitas. Se separa del entorno del arnés de US-189 solo en lo que distingue a cada
 * montaje (`NODE_ENV`, `SERVE_WEB`, puerto, base de datos y kinds), que es justo lo que se
 * quiere ejercer.
 */
function commonEnv(stack: StackName): NodeJS.ProcessEnv {
  const kind = KIND_DEL_STACK[stack];
  return {
    ...process.env,
    DATABASE_URL: `file:${dbFile(stack)}`,
    DRIVER_KIND: kind,
    VPN_KIND: kind,
    IOT_KIND: kind,
    CAMERAS_KIND: kind,
    FIREWALL_KIND: kind,
    VLAN_KIND: kind,
    QOS_KIND: kind,
    DNS_KIND: kind,
    JWT_PRIVATE_KEY_PATH: './keys/jwt-private.pem',
    JWT_PUBLIC_KEY_PATH: './keys/jwt-public.pem',
    WEBAUTHN_RP_ID: 'localhost',
    WEBAUTHN_ORIGIN: BASE_URL[stack],
  };
}

/** Aplica el esquema a una DB efímera limpia con el CLI de migraciones (`dist/migrate.js`, ya construido). */
function resetDb(stack: StackName): void {
  const file = dbFile(stack);
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(`${file}${suffix}`, { force: true });
  }
  execFileSync(process.execPath, ['dist/migrate.js'], {
    cwd: AGENT_DIR,
    env: { ...process.env, DATABASE_URL: `file:${file}` },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

/**
 * Lanza un proceso en su **propio grupo** (`detached`) para poder matar el árbol
 * entero en el teardown: `tsx watch` y `vite` lanzan hijos que sobrevivirían a un
 * kill del PID directo y dejarían el puerto ocupado para la siguiente tanda.
 */
function launch(
  cmd: string,
  args: string[],
  opts: { cwd: string; env: NodeJS.ProcessEnv; label: string },
): { child: ChildProcess; output: () => string } {
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: opts.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  running.push(child);

  let output = '';
  const capture = (buf: Buffer) => {
    output += buf.toString();
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);
  return { child, output: () => output };
}

/** Espera a que una URL responda, o lanza con la salida capturada del proceso. */
async function waitForHttp(
  url: string,
  child: ChildProcess,
  output: () => string,
  label: string,
  timeoutMs = 120_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`[${label}] murió al arrancar (código ${child.exitCode}).\n${output()}`);
    }
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // aún no escucha
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`[${label}] no respondió en ${timeoutMs / 1000} s.\n${output()}`);
}

/**
 * Extrae el token de configuración de la salida del agente. Se imprime por
 * `process.stdout.write` directo (no por pino), así que sobrevive también al
 * logger JSON de producción — que es precisamente lo que este arnés comprueba.
 */
function extractSetupToken(out: string): string | null {
  const m =
    out.match(/token de configuración:\s*([A-Za-z0-9_-]+)/) ??
    out.match(/[?&]token=([A-Za-z0-9_-]+)/);
  return m?.[1] ?? null;
}

async function waitForSetupToken(
  child: ChildProcess,
  output: () => string,
  label: string,
): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const token = extractSetupToken(output());
    if (token) return token;
    if (child.exitCode !== null) {
      throw new Error(`[${label}] murió antes de imprimir el token.\n${output()}`);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `[${label}] no imprimió el token de configuración en 30 s. ` +
      `Sin él no se puede completar el wizard.\n${output()}`,
  );
}

/**
 * Levanta el stack de desarrollo: agente en :3001 y Vite en :5173 proxeando
 * hacia él. Replica lo que hace `pnpm dev` (`pnpm -r --parallel dev`) con
 * puertos y DB controlados, con una diferencia deliberada: el agente va con
 * `tsx` a secas y no `tsx watch`. El modo watch solo añade reinicios del backend
 * a mitad de tanda —ruido, no señal— y ningún flujo del navegador depende de él;
 * el HMR del frontend, que sí importa, lo pone Vite y aquí está intacto.
 */
async function startDev(): Promise<string> {
  resetDb('dev');

  const agent = launch('npx', ['tsx', 'src/index.ts'], {
    cwd: AGENT_DIR,
    env: {
      ...commonEnv('dev'),
      NODE_ENV: 'development',
      PORT: String(PORTS.devAgent),
      // En `pnpm dev` el agente NO sirve la web: la sirve Vite.
      SERVE_WEB: 'false',
    },
    label: 'dev/agent',
  });
  await waitForHttp(
    `http://localhost:${PORTS.devAgent}/health/ready`,
    agent.child,
    agent.output,
    'dev/agent',
  );
  const token = await waitForSetupToken(agent.child, agent.output, 'dev/agent');

  const web = launch('npx', ['vite', '--port', String(PORTS.devWeb), '--strictPort'], {
    cwd: WEB_DIR,
    env: { ...process.env, VITE_AGENT_URL: `http://localhost:${PORTS.devAgent}` },
    label: 'dev/web',
  });
  await waitForHttp(BASE_URL.dev, web.child, web.output, 'dev/web');

  return token;
}

/**
 * Levanta el stack de producción: `NODE_ENV=production node dist/index.js` con
 * `SERVE_WEB=true`, o sea el paso [5/5] de `scripts/prod.sh`. Se asume que
 * `pnpm build` ya corrió (lo hace `global-setup`).
 */
async function startProd(): Promise<string> {
  resetDb('prod');

  const agent = launch('node', ['dist/index.js'], {
    cwd: AGENT_DIR,
    env: {
      ...commonEnv('prod'),
      NODE_ENV: 'production',
      PORT: String(PORTS.prod),
      SERVE_WEB: 'true',
    },
    label: 'prod',
  });
  await waitForHttp(`${BASE_URL.prod}/health/ready`, agent.child, agent.output, 'prod');
  return await waitForSetupToken(agent.child, agent.output, 'prod');
}

/**
 * Comprueba que los tres puertos están libres **antes de lanzar nada**. Con otro
 * proceso en el :3001, `vite` proxea a ese agente ajeno y el setup muere 60 s
 * después contra un formulario que no es el nuestro: nada apunta al puerto.
 */
async function comprobarPuertos(): Promise<void> {
  const puertos: [string, number][] = [
    ['agente de dev', PORTS.devAgent],
    ['Vite de dev', PORTS.devWeb],
    ['prod', PORTS.prod],
  ];
  // Tras matar los árboles de una tanda anterior el SO tarda un instante en soltarlos.
  const limite = Date.now() + 10_000;
  for (;;) {
    const ocupados: string[] = [];
    for (const [nombre, puerto] of puertos) {
      if (await puertoOcupado(puerto)) {
        ocupados.push(`:${puerto} (${nombre}, ${quienTieneElPuerto(puerto)})`);
      }
    }
    if (ocupados.length === 0) return;
    if (Date.now() > limite) {
      throw new Error(
        `Puertos ocupados, no se lanza nada: ${ocupados.join(', ')}. ` +
          `Páralos con \`kill -TERM <pid>\` (nunca -9) y reintenta.`,
      );
    }
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Arranca ambos stacks y persiste sus tokens de configuración para los specs. */
export async function startStacks(): Promise<void> {
  stopStacks();
  await comprobarPuertos();
  const setupToken = { dev: await startDev(), prod: await startProd() };
  const pids = running.map((c) => c.pid).filter((p): p is number => typeof p === 'number');
  writeFileSync(STATE_FILE, JSON.stringify({ setupToken, pids } satisfies StacksState));
}

/**
 * Mata los árboles de procesos de ambos stacks y limpia el estado. Idempotente:
 * también sirve para limpiar los restos de una tanda anterior que se interrumpió
 * (por eso lee los PID del disco además de los que tenga en memoria).
 */
export function stopStacks(): void {
  const pids = new Set<number>();
  for (const child of running.splice(0)) {
    if (child.pid) pids.add(child.pid);
  }
  try {
    for (const pid of readStacksState().pids) pids.add(pid);
  } catch {
    // no hay estado previo
  }
  // SIGTERM primero y a TODO el grupo (negativo): `vite` deja hijos vivos si se mata
  // solo el PID, y un SIGKILL directo a un agente a media escritura de SQLite es
  // justo como se corrompe la base. Solo si tras ~10 s sigue vivo, SIGKILL.
  const vivo = (pid: number): boolean => {
    try {
      process.kill(-pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  for (const pid of pids) {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      // ya murió
    }
  }
  const limite = Date.now() + 10_000;
  while (Date.now() < limite && [...pids].some(vivo)) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  for (const pid of pids) {
    if (!vivo(pid)) continue;
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // ya murió
    }
  }
  rmSync(STATE_FILE, { force: true });
}
