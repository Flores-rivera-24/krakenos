import { defineConfig } from 'tsup';

/**
 * Bundle del agente para producción (`pnpm start` → `node dist/index.js`).
 * Las dependencias de `node_modules` quedan externas; sólo se inlinea el
 * paquete de workspace `@krakenos/types`, que se publica como fuente `.ts`.
 */
export default defineConfig({
  // `index.ts` = agente; `update-runner.ts` = proceso actualizador one-click
  // independiente (US-190), lanzado detached para sobrevivir al reinicio del agente;
  // `reset-admin.ts` = recuperación de la cuenta de admin desde el host (US-233),
  // que no existe como endpoint a propósito.
  entry: ['src/index.ts', 'src/update-runner.ts', 'src/reset-admin.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@krakenos/types'],
});
