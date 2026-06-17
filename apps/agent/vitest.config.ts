import { defineConfig } from 'vitest/config';

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
  },
});
