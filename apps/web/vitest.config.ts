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
    // Coverage (US-60/US-99/US-230). **`all: true` desde US-230**: mide TODO
    // `src/**`, no solo lo que los tests importan — el agente ya lo hacía desde
    // US-219 y la web arrastraba un `all: false` que la 3ª auditoría (AUD3-34)
    // midió y descartó como deuda: con `all: true` ya pasaba el umbral, así que
    // el `false` no era deuda, era inercia.
    //
    // `thresholds` = suelo anti-regresión ~1-2 pts por debajo del número real,
    // no un objetivo. El de funciones es más bajo a propósito: muchos componentes
    // exponen handlers/callbacks que no todos los tests disparan
    // (ver docs/coverage-notes.md).
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      // Se excluyen SOLO los entrypoints, misma política que el agente (US-219):
      // `main.tsx` monta la app (efectos, no unit-testable sin navegador) y
      // `vite-env.d.ts` son tipos.
      exclude: ['src/main.tsx', 'src/vite-env.d.ts'],
      // ⚠️ Honestidad del número: los catálogos i18n y las 25 guías del asistente
      // SÍ cuentan, y son `export const` de texto que v8 marca como cubierto solo
      // con importarse. Eso infla statements/lines (~88 %). **El número que dice
      // la verdad sobre la web es el de funciones** (~66 %): mide handlers y
      // callbacks realmente disparados. Por eso su suelo se sube aparte.
      thresholds: {
        statements: 85,
        branches: 78,
        functions: 64,
        lines: 85,
      },
    },
  },
});
