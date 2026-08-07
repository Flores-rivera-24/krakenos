#!/usr/bin/env node
/**
 * Prueba de RENDIMIENTO de la API (no funcional).
 *
 * Qué mide y por qué. El proyecto tenía presupuesto de tamaño del bundle web
 * (US-193) pero **ninguna medida de la API**: nadie sabía cuántas peticiones por
 * segundo aguanta el agente ni cuánto tarda una lectura del inventario bajo
 * carga. En un aparato doméstico (una Raspberry, un mini-PC) eso importa más que
 * en un servidor: el hardware es modesto y SQLite serializa las escrituras.
 *
 * Cómo. Levanta el agente **construido** con todos los managers en mock (mismo
 * montaje que e2e), crea el admin, hace login y lanza `autocannon` contra un
 * puñado de rutas representativas. Falla si alguna incumple su presupuesto de
 * latencia p99 o de throughput mínimo.
 *
 * Honestidad del número. Es una medida **relativa**, para detectar regresiones
 * (una consulta N+1 nueva, un JSON gigante sin paginar), no una promesa de
 * capacidad: corre en la máquina de quien lo ejecute, con mocks en vez de
 * hardware real. Por eso los presupuestos son holgados y lo que se vigila es el
 * cambio, no el valor absoluto. Los resultados se guardan en
 * `qa-reports/perf/` para poder comparar entre ejecuciones.
 */
import autocannon from 'autocannon';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const AGENT_DIR = resolve(ROOT, 'apps/agent');
const OUT_DIR = resolve(ROOT, 'qa-reports/perf');

const PORT = 3998;
const BASE = `http://127.0.0.1:${PORT}`;
const DB_FILE = resolve(AGENT_DIR, 'prisma/perf.db');

/** Duración de cada escenario. Corto a propósito: esto corre en cada revisión. */
const DURATION_S = Number(process.env.PERF_DURATION ?? 5);
const CONNECTIONS = Number(process.env.PERF_CONNECTIONS ?? 20);

/**
 * Presupuestos por ruta. `p99Ms` es el techo de latencia del percentil 99 y
 * `minRps` el suelo de peticiones/segundo.
 *
 * De dónde salen los números: se **midieron** primero (portátil, 20 conexiones,
 * 5 s) y el presupuesto se fijó en ~4× la latencia observada y ~¼ del throughput
 * observado. Ese margen es deliberado y tiene dos lados: lo bastante ancho para
 * no saltar porque la máquina esté ocupada, y lo bastante estrecho para que una
 * regresión de verdad —una consulta N+1, un JSON sin paginar, un `await` dentro
 * de un bucle— lo rompa. Un presupuesto 10× por encima de lo medido no vigila
 * nada: siempre pasa.
 *
 * `medido` deja por escrito la foto de referencia. Si alguien vuelve a medir en
 * otra máquina y los números bailan mucho, ahí está la comparación.
 */
const ESCENARIOS = [
  {
    nombre: 'GET /api/system/info (público, sin DB pesada)',
    path: '/api/system/info',
    auth: false,
    medido: { rps: 3356, p99Ms: 16 },
    p99Ms: 100,
    minRps: 800,
  },
  {
    nombre: 'GET /api/inventory/devices (lectura con DB)',
    path: '/api/inventory/devices',
    auth: true,
    medido: { rps: 1307, p99Ms: 29 },
    p99Ms: 150,
    minRps: 300,
  },
  {
    nombre: 'GET /api/iot/devices (estado IoT agregado)',
    path: '/api/iot/devices',
    auth: true,
    medido: { rps: 1078, p99Ms: 31 },
    p99Ms: 150,
    minRps: 250,
  },
  {
    nombre: 'GET /api/dns/stats (agregado)',
    path: '/api/dns/stats',
    auth: true,
    medido: { rps: 1254, p99Ms: 34 },
    p99Ms: 150,
    minRps: 300,
  },
  {
    // La ruta más cara del arranque de la UI: la pide cada cliente al entrar.
    nombre: 'GET /api/system/settings (ajustes del hogar)',
    path: '/api/system/settings',
    auth: true,
    medido: { rps: 980, p99Ms: 42 },
    p99Ms: 200,
    minRps: 220,
  },
];

function agentEnv() {
  return {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(PORT),
    DATABASE_URL: `file:${DB_FILE}`,
    SERVE_WEB: 'false',
    DRIVER_KIND: 'mock',
    VPN_KIND: 'mock',
    IOT_KIND: 'mock',
    CAMERAS_KIND: 'mock',
    FIREWALL_KIND: 'mock',
    VLAN_KIND: 'mock',
    QOS_KIND: 'mock',
    DNS_KIND: 'mock',
    JWT_PRIVATE_KEY_PATH: './keys/jwt-private.pem',
    JWT_PUBLIC_KEY_PATH: './keys/jwt-public.pem',
    // Sin límite de peticiones: aquí se mide el servidor, no el rate-limiter
    // (que además devolvería 429 y falsearía la latencia).
    LOGIN_RATE_LIMIT: '100000',
  };
}

async function arrancarAgente() {
  for (const sufijo of ['', '-journal', '-wal', '-shm']) {
    rmSync(`${DB_FILE}${sufijo}`, { force: true });
  }
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: AGENT_DIR,
    env: { ...process.env, DATABASE_URL: `file:${DB_FILE}` },
    stdio: 'ignore',
  });

  const hijo = spawn('node', ['dist/index.js'], {
    cwd: AGENT_DIR,
    env: agentEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let salida = '';
  let setupToken = '';
  const capturar = (buf) => {
    salida += buf.toString();
    const m =
      salida.match(/token de configuración:\s*([A-Za-z0-9_-]+)/) ??
      salida.match(/[?&]token=([A-Za-z0-9_-]+)/);
    if (m?.[1]) setupToken = m[1];
  };
  hijo.stdout?.on('data', capturar);
  hijo.stderr?.on('data', capturar);

  const limite = Date.now() + 60_000;
  while (Date.now() < limite) {
    if (hijo.exitCode !== null) {
      throw new Error(`El agente murió al arrancar (código ${hijo.exitCode}).\n${salida}`);
    }
    try {
      const res = await fetch(`${BASE}/health/ready`);
      if (res.ok && setupToken) break;
    } catch {
      // aún no escucha
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!setupToken) {
    hijo.kill('SIGKILL');
    throw new Error(`No se capturó el token de configuración.\n${salida}`);
  }
  return { hijo, setupToken };
}

async function crearAdminYLogin(setupToken) {
  const email = 'perf@krakenos.test';
  const password = 'perf-password-123';
  const init = await fetch(`${BASE}/api/setup/init`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      homeName: 'Casa de rendimiento',
      email,
      password,
      displayName: 'Perf',
      setupToken,
    }),
  });
  if (!init.ok) throw new Error(`setup/init falló: ${init.status} ${await init.text()}`);

  // El propio `/setup/init` deja la sesión abierta (devuelve el access token), así
  // que no hace falta un login extra: uno menos que pueda chocar con el límite de
  // intentos y una fuente menos de ruido en la medida.
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error(`login falló: ${login.status} ${await login.text()}`);
  const cuerpoLogin = await login.json();
  const accessToken = cuerpoLogin.tokens?.accessToken;
  if (!accessToken) {
    throw new Error(`el login no devolvió tokens.accessToken: ${JSON.stringify(cuerpoLogin)}`);
  }
  return accessToken;
}

function correrEscenario(escenario, token) {
  return new Promise((resolver, rechazar) => {
    autocannon(
      {
        url: `${BASE}${escenario.path}`,
        connections: CONNECTIONS,
        duration: DURATION_S,
        headers: escenario.auth ? { authorization: `Bearer ${token}` } : {},
      },
      (err, resultado) => (err ? rechazar(err) : resolver(resultado)),
    );
  });
}

async function main() {
  const { hijo, setupToken } = await arrancarAgente();
  const incumplimientos = [];
  const informe = [];

  try {
    const token = await crearAdminYLogin(setupToken);

    for (const escenario of ESCENARIOS) {
      const r = await correrEscenario(escenario, token);

      // Un escenario que devuelve errores o respuestas no-2xx no mide nada útil:
      // «muy rápido devolviendo 401» no es rendimiento. Se trata como fallo.
      const noOk = r.non2xx + r.errors;
      const rps = r.requests.average;
      const p99 = r.latency.p99;

      informe.push({
        escenario: escenario.nombre,
        path: escenario.path,
        rps: Math.round(rps),
        latenciaMediaMs: r.latency.average,
        latenciaP99Ms: p99,
        peticiones: r.requests.total,
        noOk,
        presupuesto: { p99Ms: escenario.p99Ms, minRps: escenario.minRps },
      });

      const marca = `${escenario.nombre}`;
      if (noOk > 0) {
        incumplimientos.push(`${marca}: ${noOk} respuestas no-2xx o errores de conexión`);
      }
      if (p99 > escenario.p99Ms) {
        incumplimientos.push(`${marca}: p99 ${p99} ms > presupuesto ${escenario.p99Ms} ms`);
      }
      if (rps < escenario.minRps) {
        incumplimientos.push(
          `${marca}: ${Math.round(rps)} req/s < mínimo ${escenario.minRps} req/s`,
        );
      }

      process.stdout.write(
        `${p99 > escenario.p99Ms || rps < escenario.minRps || noOk ? '✗' : '✓'} ${marca}\n` +
          `    ${Math.round(rps)} req/s · media ${r.latency.average} ms · p99 ${p99} ms` +
          `${noOk ? ` · ${noOk} no-2xx` : ''}\n`,
      );
    }
  } finally {
    hijo.kill('SIGKILL');
    for (const sufijo of ['', '-journal', '-wal', '-shm']) {
      rmSync(`${DB_FILE}${sufijo}`, { force: true });
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    resolve(OUT_DIR, 'perf-api.json'),
    JSON.stringify(
      { fecha: new Date().toISOString(), duracionS: DURATION_S, conexiones: CONNECTIONS, informe },
      null,
      2,
    ),
  );
  process.stdout.write(`\nInforme en qa-reports/perf/perf-api.json\n`);

  if (incumplimientos.length > 0) {
    process.stderr.write(`\nPresupuesto de rendimiento incumplido:\n`);
    for (const i of incumplimientos) process.stderr.write(`  · ${i}\n`);
    process.exit(1);
  }
  process.stdout.write('Todos los escenarios dentro de presupuesto.\n');
}

main().catch((err) => {
  process.stderr.write(`${err.stack ?? err}\n`);
  process.exit(1);
});
