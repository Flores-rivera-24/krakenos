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
    // Coverage informativo (US-60): sin umbrales que bloqueen. `all: false` mide solo
    // lo que tocan los tests.
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      all: false,
    },
  },
});
