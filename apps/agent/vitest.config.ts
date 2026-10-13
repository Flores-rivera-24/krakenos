import { coverageConfigDefaults, defineConfig } from 'vitest/config';

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
    include: ['test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./test/globalSetup.ts'],
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
    // Coverage honesto (US-219). `all: true` mide **todo** `src/**`, no solo lo
    // que los tests importan: el número refleja la realidad del árbol (incluidos
    // los transports de hardware SSH/SNMP/HTTP que solo se verifican con equipo
    // real, US-86), no "de lo que se usa, cuánto se ejerce". Excludes legítimos:
    // los **entrypoints** con efectos secundarios (`index.ts` arranca/escucha;
    // `update-runner.ts` es el proceso actualizador aparte; `reset-admin.ts` es la
    // recuperación de admin desde el host, US-233) — no son unit-testables sin
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
