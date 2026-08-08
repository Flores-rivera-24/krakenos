import { defineConfig } from 'vitest/config';

/**
 * Config de Vitest **solo para la campaña de mutación** (Stryker).
 *
 * Es aparte de `vitest.config.ts` a propósito: Stryker re-ejecuta la suite una
 * vez por mutante, y la suite completa del agente tarda ~5 min porque arranca
 * SQLite, aplica migraciones y monta Fastify. Aquí se acotan los tests a los de
 * **lógica pura** que cubren los ficheros mutados (autorización, tokens,
 * lockout, máquina de estados de la alarma), que corren en milisegundos.
 *
 * Sin `globalSetup`: ninguno de estos tests toca la base de datos.
 */
export default defineConfig({
  test: {
    include: [
      'test/unit/capabilities.test.ts',
      'test/unit/api-token.test.ts',
      'test/unit/login-lockout.test.ts',
      'test/unit/attempt-lockout.test.ts',
      'test/unit/alarm-state-machine.test.ts',
      'test/unit/alarm-life-safety.test.ts',
    ],
    environment: 'node',
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
