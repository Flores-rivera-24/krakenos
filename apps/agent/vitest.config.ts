import { configDefaults, coverageConfigDefaults, defineConfig } from 'vitest/config';

// Tests de disco/SQLite: en Windows se reintentan como GRUPO (un pico del runner, no un test, los tumba:
// db-client entero 32,8 s vs mediana 6,9 s; 15 runs, 2026-11-17). Lista cerrada; la ata saltos-por-plataforma.
export const ARCHIVOS_DISCO: readonly string[] = [
  'backup-claves',
  'backup-stream',
  'backup',
  'db-client',
  'json-store',
  'migrate',
  'restore-newer',
  'restore-poda',
  'restore-stream',
  'restore-wal',
  'restore',
].map((n) => `test/unit/${n}.test.ts`);

// Los projects NO usan `extends: true`: heredarían `globalSetup` y lo ejecutarían una vez por project
// (medido: 3 llamadas) sobre la misma `test.db`. Lo común va aquí y `globalSetup` queda solo en la raíz.
const comun = {
  environment: 'node' as const,
  // Una sola base SQLite compartida: los archivos de test no corren en paralelo
  // para evitar carreras al limpiar tablas entre suites.
  fileParallelism: false,
  env: {
    NODE_ENV: 'test',
    DATABASE_URL: 'file:./test.db',
    JWT_PRIVATE_KEY_PATH: './keys/jwt-private.pem',
    JWT_PUBLIC_KEY_PATH: './keys/jwt-public.pem',
    DRIVER_KIND: 'mock',
    WEB_ORIGIN: 'http://localhost:5173',
    ACCESS_TOKEN_TTL: '900',
    REFRESH_TOKEN_TTL: '2592000',
  },
};

/**
 * Config de Vitest para el agente.
 *
 * Las pruebas corren contra una base SQLite **aislada** (`prisma/test.db`),
 * nunca contra `dev.db`. Las variables de entorno (DB + rutas de claves JWT)
 * se inyectan aquí para no depender de un `.env` cargado por el entrypoint.
 * `globalSetup` aplica las migraciones a esa base y la borra al terminar.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...comun,
          name: 'disco',
          include: [...ARCHIVOS_DISCO],
          retry: process.platform === 'win32' ? 1 : 0,
        },
      },
      {
        test: {
          ...comun,
          name: 'general',
          include: ['test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, ...ARCHIVOS_DISCO],
        },
      },
    ],
    globalSetup: ['./test/globalSetup.ts'],
    // Coverage honesto (US-219). `all: true` mide **todo** `src/**`, no solo lo
    // que los tests importan: el número refleja la realidad del árbol (incluidos
    // los transports de hardware SSH/SNMP/HTTP que solo se verifican con equipo
    // real, US-86), no "de lo que se usa, cuánto se ejerce". Excludes legítimos:
    // los **entrypoints** con efectos secundarios (`index.ts` arranca/escucha;
    // `update-runner.ts` es el proceso actualizador aparte; `reset-admin.ts` es la
    // recuperación de admin desde el host, US-233; `migrate.ts` es el CLI de migraciones, US-275, cuya
    // lógica vive en `db/migrate.ts`) — no son unit-testables sin
    // arrancar el proceso; su lógica sí vive en módulos que se prueban. Los `thresholds` son un **suelo anti-regresión**
    // fijado ~1–2 pts por debajo del número real medido (ver docs/coverage-notes.md
    // para el número vigente y el plan de subida gradual).
    // Vitest 4 retiró `coverage.all`: ahora lo decide `include` (mide TODO lo que
    // casa, importado o no).
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      include: ['src/**/*.ts'],
      exclude: [
        ...coverageConfigDefaults.exclude,
        'src/index.ts',
        'src/update-runner.ts',
        'src/reset-admin.ts',
        'src/migrate.ts',
        // CLIs de claves y de la CA local (US-277): solo cablean `process` a la lógica de
        // `crypto/*.ts`, que sí se prueba (`runKeysCli` / `runLocalCaCli`).
        'src/keys.ts',
        'src/local-ca.ts',
        // Cliente de Prisma 7 GENERADO (US-276): código ajeno, no se mide ni se testea.
        'src/generated/**',
      ],
      // Suelos recalibrados el 2026-10-13 con Vitest 4.1.11: medido sentencias 89,18 · ramas 81,29 · funciones 86,78 · líneas 91,16.
      // Motivo: Vitest >= 3.2 remapea V8 por AST (como Istanbul) y cambia qué cuenta
      // como sentencia/rama/función (p. ej. cada catálogo i18n pasa de miles de
      // «sentencias» a 1); mismos tests y mismo código. Suelo = medido − 2, hacia abajo.
      thresholds: {
        statements: 87,
        branches: 79,
        functions: 84,
        lines: 89,
      },
    },
  },
});
