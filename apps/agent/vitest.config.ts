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
    // los dos **entrypoints** con efectos secundarios (`index.ts` arranca/escucha;
    // `update-runner.ts` es el proceso actualizador aparte) — no son unit-testables
    // sin arrancar el proceso. Los `thresholds` son un **suelo anti-regresión**
    // fijado ~1–2 pts por debajo del número real medido (ver docs/coverage-notes.md
    // para el número vigente y el plan de subida gradual).
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      all: true,
      include: ['src/**/*.ts'],
      exclude: [...coverageConfigDefaults.exclude, 'src/index.ts', 'src/update-runner.ts'],
      thresholds: {
        statements: 89,
        branches: 83,
        functions: 90,
        lines: 89,
      },
    },
  },
});
