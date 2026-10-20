import { isAbsolute, resolve } from 'node:path';
import { agentPaths } from '../config/paths.js';

/**
 * Ruta del fichero SQLite de una `DATABASE_URL` (`file:…`).
 *
 * Una ruta relativa se resuelve respecto a `prisma/` (el directorio del schema), NO
 * respecto al cwd: con Prisma 5 la resolvía el motor así, y todas las instalaciones
 * existentes escribieron `DATABASE_URL=file:./dev.db` esperando `prisma/dev.db`. El
 * adaptador de better-sqlite3 (Prisma 7) abre la ruta tal cual contra el cwd, así que
 * esta regla tiene que seguir viviendo aquí, en UN sitio: la usan el cliente
 * (`db/client.ts`), el aplicador de migraciones, la restauración y `prisma.config.ts`.
 *
 * Se descarta cualquier `?query` (p. ej. `?connection_limit=1`, que era del motor de Prisma 5).
 */
export function resolveDbFile(databaseUrl: string): string {
  const p = databaseUrl.replace(/^file:/, '').replace(/\?.*$/, '');
  return isAbsolute(p) ? p : resolve(agentPaths().prismaDir, p);
}
