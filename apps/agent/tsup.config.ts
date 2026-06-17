import { defineConfig } from 'tsup';

/**
 * Bundle del agente para producción (`pnpm start` → `node dist/index.js`).
 * Las dependencias de `node_modules` quedan externas; sólo se inlinea el
 * paquete de workspace `@krakenos/types`, que se publica como fuente `.ts`.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@krakenos/types'],
});
