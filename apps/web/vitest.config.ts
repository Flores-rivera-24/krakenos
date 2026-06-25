import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Config de Vitest para la web. Entorno jsdom para tests de componentes y
 * stores; alias `@` igual que en `vite.config.ts`.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    css: false,
    restoreMocks: true,
    // Coverage (US-60/US-99). `all: false` mide solo lo que tocan los tests.
    // `thresholds` = suelo anti-regresión por debajo de los números reales
    // (~88% stmts / ~84% branch / ~67% funcs), no un objetivo. El suelo de
    // funciones es más bajo a propósito: muchos componentes exponen handlers/
    // callbacks que no todos los tests disparan (ver docs/coverage-notes.md).
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      all: false,
      thresholds: {
        statements: 85,
        branches: 78,
        functions: 60,
        lines: 85,
      },
    },
  },
});
