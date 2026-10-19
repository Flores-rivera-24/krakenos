import { defineConfig } from 'tsup';

/**
 * Segundo bundle del agente: la CLI de la CA local (`dist/local-ca.js`) en UN solo
 * fichero, con todas sus dependencias dentro.
 *
 * El timer `krakenos-cert-local` la ejecuta como ROOT, y root nunca ejecuta nada que el
 * usuario del servicio pueda modificar. El resto de `dist/` importa de `node_modules/`,
 * que es del servicio, así que este fichero no puede depender de él: el instalador lo
 * copia a `/usr/local/lib/krakenos/` (root 0755) y allí tiene que arrancar solo.
 *
 * Va aparte de `tsup.config.ts` y se ejecuta DESPUÉS (`pnpm build`): el primero hace
 * `clean: true` y, en paralelo, borraría este resultado.
 */
export default defineConfig({
  entry: ['src/local-ca.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: false,
  splitting: false,
  sourcemap: false,
  noExternal: [/.*/],
  // Dependencias CommonJS empaquetadas dentro de un ESM piden `require` (Node no lo define).
  banner: {
    js: "import { createRequire as __krakenCreateRequire } from 'node:module'; const require = __krakenCreateRequire(import.meta.url);",
  },
});
