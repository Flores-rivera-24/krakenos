import { resolve } from 'node:path';

/**
 * Dónde vive cada cosa en disco (US-280), resuelto en UN sitio.
 *
 * Hasta ahora cada módulo hacía `resolve('data/…')` / `resolve('var')` contra el `cwd`, lo
 * que suponía «el agente corre desde `apps/agent`». Un servicio de Windows o un paquete
 * instalado no arranca ahí: el código vive en una carpeta de solo lectura y el estado en
 * otra. Hay DOS raíces:
 *
 *  - `KRAKENOS_DATA_DIR` — el ESTADO que cambia: base SQLite (`prisma/`), `data/`, `var/`,
 *    `keys/`, `certs/`, el staging de la restauración.
 *  - `KRAKENOS_APP_DIR` — el CÓDIGO: `prisma/migrations` y la web construida (`../web/dist`).
 *
 * Ambas valen por defecto el `cwd`, así que sin las variables el layout es EXACTAMENTE el de
 * antes (Linux con `install.sh`, `pnpm prod`, Docker). Precedencia, de mayor a menor:
 *
 *   1. la variable específica que ya existía (`WG_PEER_STORE`, `SECRETBOX_KEY_PATH`,
 *      `WEB_DIST_PATH`, `DATABASE_URL`, `KRAKENOS_PRE_MIGRATE_DIR`…), la aplica quien la lee;
 *   2. lo derivado de `KRAKENOS_DATA_DIR` / `KRAKENOS_APP_DIR`;
 *   3. el layout de siempre, relativo al `cwd`.
 *
 * Por eso aquí solo se calcula el nivel 2/3 y los llamadores conservan su `process.env.X ??`.
 *
 * Es el ÚNICO fichero de `src/` que puede nombrar `process.cwd()` o componer `data`/`var`/
 * `keys`/`certs`/`prisma` a mano; lo ata `test/unit/rutas-de-estado.test.ts`.
 */
export interface AgentPaths {
  /** Raíz del estado (`KRAKENOS_DATA_DIR`). */
  dataRoot: string;
  /** Raíz del código (`KRAKENOS_APP_DIR`). */
  appRoot: string;
  /** `<dataRoot>/data`: stores JSON, grabaciones, copias automáticas. */
  dataDir: string;
  /** `<dataRoot>/var`: traspasos, staging de restauración, copias previas. */
  varDir: string;
  /** `<dataRoot>/keys`: claves JWT y secretbox. */
  keysDir: string;
  /** `<dataRoot>/certs`: certificados públicos (la CA local). */
  certsDir: string;
  /** `<dataRoot>/prisma`: contra él se resuelve una `DATABASE_URL` relativa. */
  prismaDir: string;
  /** `<appRoot>/prisma/migrations`. */
  migrationsDir: string;
  /** `<appRoot>/../web/dist`: la web construida. */
  webDistDir: string;
  /** Raíz del repositorio (`KRAKENOS_REPO_DIR`, por defecto `<appRoot>/../..`): lo usa el actualizador. */
  repoDir: string;
}

function nonEmpty(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

/** Cálculo puro: el entorno y el `cwd` entran por parámetro. */
export function resolvePaths(env: Record<string, string | undefined>, cwd: string): AgentPaths {
  const dataRoot = resolve(cwd, nonEmpty(env.KRAKENOS_DATA_DIR) ?? '.');
  const appRoot = resolve(cwd, nonEmpty(env.KRAKENOS_APP_DIR) ?? '.');
  return {
    dataRoot,
    appRoot,
    dataDir: resolve(dataRoot, 'data'),
    varDir: resolve(dataRoot, 'var'),
    keysDir: resolve(dataRoot, 'keys'),
    certsDir: resolve(dataRoot, 'certs'),
    prismaDir: resolve(dataRoot, 'prisma'),
    migrationsDir: resolve(appRoot, 'prisma', 'migrations'),
    webDistDir: resolve(appRoot, '..', 'web', 'dist'),
    repoDir: resolve(cwd, nonEmpty(env.KRAKENOS_REPO_DIR) ?? resolve(appRoot, '..', '..')),
  };
}

let cached: AgentPaths | undefined;

/**
 * Las rutas del proceso, resueltas la primera vez que se piden y ya no cambian. Perezoso a
 * propósito: `migrate.ts` cambia de directorio y carga `.env` DESPUÉS de importar sus
 * módulos, y `KRAKENOS_DATA_DIR` puede venir de ese `.env`.
 */
export function agentPaths(): AgentPaths {
  cached ??= resolvePaths(process.env, process.cwd());
  return cached;
}

/**
 * Una ruta del `.env` (`./keys/…`, `./certs/…`) se resuelve contra la raíz del ESTADO, no contra el
 * `cwd`: así `KRAKENOS_DATA_DIR` mueve también las claves JWT y los certificados, y todas quedan en el
 * mismo árbol que `secretbox.key`. Sin la variable la raíz ES el `cwd`, y una ruta absoluta no cambia.
 */
export function resolveStatePath(path: string): string {
  return resolve(agentPaths().dataRoot, path);
}

/** Solo para tests: olvida la resolución memorizada. */
export function resetAgentPathsForTests(): void {
  cached = undefined;
}
