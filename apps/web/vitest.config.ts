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
    // Vitest 4 retiró `coverage.all`: ahora lo decide `include` (mide TODO lo que
    // casa, importado o no).
    coverage: {
      provider: 'v8',
      reporter: ['text-summary'],
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
      // Suelos recalibrados el 2026-10-13 con Vitest 4.1.11: medido sentencias 73,88 · ramas 71,48 · funciones 68,51 · líneas 75,61.
      // Motivo: Vitest >= 3.2 remapea V8 por AST (como Istanbul) y cambia qué cuenta
      // como sentencia/rama/función (p. ej. cada catálogo i18n pasa de miles de
      // «sentencias» a 1); mismos tests y mismo código. Suelo = medido − 2, hacia abajo.
      thresholds: {
        statements: 71,
        branches: 69,
        functions: 66,
        lines: 73,
      },
    },
  },
});
