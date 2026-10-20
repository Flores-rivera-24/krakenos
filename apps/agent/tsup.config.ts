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
  // que no existe como endpoint a propósito; `migrate.ts` = CLI de migraciones (US-275)
  // para el instalador, Docker, el actualizador y los e2e; `keys.ts` = CLI de claves
  // (US-277: `gen` y `rotate`). La CLI de la CA local (`local-ca.ts`) NO está aquí: se
  // empaqueta aparte, autocontenida, en `tsup.root.config.ts`, porque la ejecuta root.
  entry: [
    'src/index.ts',
    'src/update-runner.ts',
    'src/reset-admin.ts',
    'src/migrate.ts',
    'src/keys.ts',
  ],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: ['@krakenos/types'],
});
