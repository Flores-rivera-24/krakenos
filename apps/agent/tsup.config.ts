import { defineConfig } from 'tsup';

/**
 * Bundle del agente para producción (`pnpm start` → `node dist/index.js`).
 * Las dependencias de `node_modules` quedan externas; sólo se inlinea el
 * paquete de workspace `@krakenos/types`, que se publica como fuente `.ts`.
 */
export default defineConfig({
  // `index.ts` = agente; `update-runner.ts` = proceso actualizador one-click
  // independiente (US-190), lanzado detached para sobrevivir al reinicio del agente.
  entry: ['src/index.ts', 'src/update-runner.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@krakenos/types'],
});
