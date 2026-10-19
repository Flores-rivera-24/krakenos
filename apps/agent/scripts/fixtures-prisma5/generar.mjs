// Regenera la fixture de Prisma 5 (US-276): una base SQLite SINTÉTICA, migrada con la CLI
// de Prisma 5 y rellena a través de su cliente, más el oráculo con lo que Prisma 5 lee.
//
// Uso (desde cualquier sitio; necesita red para instalar Prisma 5 en un temporal):
//   node apps/agent/scripts/fixtures-prisma5/generar.mjs
//
// Escribe `apps/agent/test/fixtures/prisma5/prisma5.db` y `oraculo.json`.
//
// Por qué un temporal y no el workspace: tras la subida a Prisma 7 el workspace ya no
// tiene Prisma 5, y la gracia de la fixture es que la escribió ÉL. Por eso también va
// congelado el esquema de entonces (`schema-prisma5.prisma`) y las versiones exactas.
// Las migraciones sí se copian del repo (la base debe tener todas las vigentes).
import { execFileSync } from 'node:child_process';
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PRISMA_5 = '5.22.0';

const aqui = dirname(fileURLToPath(import.meta.url));
const agente = resolve(aqui, '..', '..');
const destino = join(agente, 'test', 'fixtures', 'prisma5');

const tmp = mkdtempSync(join(tmpdir(), 'kr-fixture-prisma5-'));
try {
  writeFileSync(
    join(tmp, 'package.json'),
    JSON.stringify({
      name: 'fixture-prisma5',
      private: true,
      type: 'module',
      dependencies: { prisma: PRISMA_5, '@prisma/client': PRISMA_5 },
    }),
  );
  const run = (cmd, args, env = {}) =>
    execFileSync(cmd, args, { cwd: tmp, stdio: 'inherit', env: { ...process.env, ...env } });

  run('npm', ['install', '--no-audit', '--no-fund', '--no-package-lock']);

  mkdirSync(join(tmp, 'prisma'));
  copyFileSync(join(aqui, 'schema-prisma5.prisma'), join(tmp, 'prisma', 'schema.prisma'));
  cpSync(join(agente, 'prisma', 'migrations'), join(tmp, 'prisma', 'migrations'), {
    recursive: true,
  });
  copyFileSync(join(aqui, 'sembrar.mjs'), join(tmp, 'sembrar.mjs'));

  const env = { DATABASE_URL: 'file:./fixture.db' }; // relativa a tmp/prisma/
  run('npx', ['prisma', 'migrate', 'deploy'], env);
  run('npx', ['prisma', 'generate'], env);
  run('node', [join(tmp, 'sembrar.mjs'), join(tmp, 'oraculo.json')], env);

  mkdirSync(destino, { recursive: true });
  copyFileSync(join(tmp, 'prisma', 'fixture.db'), join(destino, 'prisma5.db'));
  copyFileSync(join(tmp, 'oraculo.json'), join(destino, 'oraculo.json'));
  console.log(`Fixture escrita en ${destino}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
