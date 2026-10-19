import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { resolveDbFile } from './src/db/database-url.js';

/**
 * Configuración de la CLI de Prisma 7 (US-276). Solo la usan los comandos de
 * DESARROLLO (`prisma generate`, `prisma migrate dev`): en producción las migraciones
 * las aplica `src/db/migrate.ts` y la conexión la abre `src/db/client.ts`.
 *
 * Prisma 7 ya no lee `.env` por su cuenta (de ahí `dotenv/config`) y la URL salió del
 * `schema.prisma`. La ruta pasa por la MISMA regla que el agente (`resolveDbFile`: una
 * relativa cuelga de `prisma/`), así que `migrate dev` toca la misma base que `pnpm dev`.
 *
 * Fuente: https://www.prisma.io/docs/orm/more/upgrade-guides/upgrading-versions/upgrading-to-prisma-7
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: `file:${resolveDbFile(process.env.DATABASE_URL ?? 'file:./dev.db')}`,
  },
});
