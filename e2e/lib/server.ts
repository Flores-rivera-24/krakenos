import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_DIR = resolve(HERE, '../../apps/agent');
const STATE_FILE = resolve(HERE, '../.state.json');
const PID_FILE = resolve(HERE, '../.server.pid');

/** Puerto fijo para que `baseURL` y `WEBAUTHN_ORIGIN` sean deterministas. */
export const E2E_PORT = 3999;
export const BASE_URL = `http://127.0.0.1:${E2E_PORT}`;

/**
 * Ruta **absoluta** de la DB efímera de e2e. Absoluta a propósito: Prisma resuelve
 * los `file:` relativos respecto al directorio del schema (`prisma/`), no al cwd,
 * así que un `file:./e2e.db` sería ambiguo entre CLI y cliente. La absoluta la fija
 * sin lugar a dudas para migrate, el agente y la limpieza.
 */
const DB_FILE = resolve(AGENT_DIR, 'prisma/e2e.db');
const DB_URL = `file:${DB_FILE}`;

/** Estado compartido entre global-setup y los specs (token de setup out-of-band). */
export interface E2EState {
  baseURL: string;
  /** Token de configuración impreso por el agente al arrancar sin usuarios (US-81/105). */
  setupToken: string;
}

export function readState(): E2EState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as E2EState;
}

/**
 * Entorno del agente para e2e: **todo mock** (sin hardware), sirviendo el frontend
 * construido en un puerto fijo, con una DB SQLite efímera propia. Sin HTTPS ni
 * TRUST_PROXY → la cookie de refresh NO es `Secure` y funciona sobre http (US-91).
 */
function agentEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'test', // ni production (Secure cookie) ni logs JSON
    PORT: String(E2E_PORT),
    DATABASE_URL: DB_URL,
    SERVE_WEB: 'true',
    DRIVER_KIND: 'mock',
    VPN_KIND: 'mock',
    IOT_KIND: 'mock',
    CAMERAS_KIND: 'mock',
    FIREWALL_KIND: 'mock',
    VLAN_KIND: 'mock',
    QOS_KIND: 'mock',
    DNS_KIND: 'mock',
    // WebAuthn coherente con el origen fijo (para el flujo 2FA en cuarentena).
    WEBAUTHN_RP_ID: 'localhost',
    WEBAUTHN_ORIGIN: BASE_URL,
    // Claves JWT explícitas (relativas al cwd del agente): en local venían del
    // `.env` gitignored, pero en CI no hay `.env` y el agente moría al arrancar
    // («Falta la variable de entorno obligatoria: JWT_PRIVATE_KEY_PATH») — era
    // la causa del job e2e rojo en main. Las genera `scripts/gen-keys.sh`.
    JWT_PRIVATE_KEY_PATH: './keys/jwt-private.pem',
    JWT_PUBLIC_KEY_PATH: './keys/jwt-public.pem',
  };
}

/**
 * Arranca el agente construido (`dist/index.js`) con managers mock, espera a que
 * `/health/ready` responda 200 y captura de su salida el **token de configuración**
 * out-of-band (el agente lo imprime al no haber usuarios). Devuelve el proceso y
 * persiste el estado en disco para los specs.
 */
export async function startServer(): Promise<ChildProcess> {
  // Mata un agente e2e previo que hubiera quedado vivo (un run anterior que no
  // limpió): si no, ocuparía el puerto y responderíamos contra él por error.
  stopServer();

  // DB efímera limpia en cada arranque (setup parte de cero, sin usuarios).
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    rmSync(`${DB_FILE}${suffix}`, { force: true });
  }

  // El agente NO migra al arrancar (eso es `migrate deploy`): aplica el esquema a
  // la DB efímera antes de levantarlo, o las consultas Prisma fallarían.
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: AGENT_DIR,
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: 'ignore',
  });

  const child = spawn('node', ['dist/index.js'], {
    cwd: AGENT_DIR,
    env: agentEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // El PID se anota **ya**, no al final. Si el arranque falla a medias, el proceso
  // existe igual y hay que poder esperarlo antes de borrar la base en el siguiente
  // intento; anotarlo solo tras el éxito dejaba justo ese caso sin rastro.
  if (!existsSync(dirname(PID_FILE))) mkdirSync(dirname(PID_FILE), { recursive: true });
  writeFileSync(PID_FILE, String(child.pid));

  let output = '';
  let setupToken = '';
  const capture = (buf: Buffer) => {
    output += buf.toString();
    // El token se imprime como `(token de configuración: XXX)` o embebido en la
    // URL `/setup?token=XXX`. base64url → [A-Za-z0-9_-].
    const m =
      output.match(/token de configuración:\s*([A-Za-z0-9_-]+)/) ??
      output.match(/[?&]token=([A-Za-z0-9_-]+)/);
    if (m?.[1]) setupToken = m[1];
  };
  child.stdout?.on('data', capture);
  child.stderr?.on('data', capture);

  const deadline = Date.now() + 60_000;
  // Espera a readiness Y a haber capturado el token (ambos ocurren al arrancar).
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`El agente e2e murió al arrancar (código ${child.exitCode}).\n${output}`);
    }
    try {
      const res = await fetch(`${BASE_URL}/health/ready`);
      if (res.ok && setupToken) break;
    } catch {
      // aún no escucha; reintenta
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  if (!setupToken) {
    // Por `stopServer`, no con un `kill` suelto: hay que ESPERAR a que muera antes
    // de que el siguiente intento borre la base, o su WAL a medio volcar reaparece
    // encima y vuelve a dejar la instalación «ya configurada».
    stopServer();
    throw new Error(`No se capturó el token de configuración en 60 s.\n${output}`);
  }

  if (!existsSync(dirname(STATE_FILE))) mkdirSync(dirname(STATE_FILE), { recursive: true });
  const state: E2EState = { baseURL: BASE_URL, setupToken };
  writeFileSync(STATE_FILE, JSON.stringify(state));
  return child;
}

/** Pausa síncrona (no hay `await` disponible: `stopServer` es sync por contrato). */
function esperarSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Detiene el agente e2e (por PID persistido) y limpia los ficheros de estado.
 *
 * **Espera a que el proceso haya muerto de verdad**, no solo a haber mandado la
 * señal. `process.kill()` vuelve de inmediato: el agente sigue vivo unos
 * milisegundos y SQLite puede estar volcando su WAL. Si mientras tanto el
 * siguiente arranque borra `e2e.db` y aplica las migraciones, esas páginas caen
 * **encima de la base recién creada** y le devuelven el usuario admin del run
 * anterior. Y con usuarios, el agente ya no imprime el token de configuración,
 * así que `startServer` agota sus 60 s y la suite entera muere en el
 * `globalSetup` con «No se capturó el token de configuración» — un error que no
 * se parece en nada a su causa. Pasaba al encadenar dos ejecuciones seguidas
 * (2 de 9 en una tarde).
 */
export function stopServer(): void {
  try {
    const pid = Number(readFileSync(PID_FILE, 'utf8'));
    if (pid) {
      process.kill(pid, 'SIGKILL');
      // `kill(pid, 0)` no envía señal: solo consulta si el proceso existe, y
      // lanza ESRCH cuando ya no. Techo de 5 s para no colgar la suite si el
      // PID quedó huérfano o lo reusó otro proceso.
      const limite = Date.now() + 5_000;
      while (Date.now() < limite) {
        try {
          process.kill(pid, 0);
        } catch {
          break; // ya no existe
        }
        esperarSync(25);
      }
    }
  } catch {
    // ya no existe / ya murió
  }
  for (const f of [STATE_FILE, PID_FILE]) rmSync(f, { force: true });
}
