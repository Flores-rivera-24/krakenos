/**
 * Proceso actualizador (US-190). Entrypoint **independiente** del agente
 * (`dist/update-runner.js <version>`), lanzado detached por `UpdateService.apply()`.
 *
 * Vive en su propio proceso a propósito: el paso `restart` reinicia el servicio del
 * agente, lo que mataría al orquestador si corriera dentro de él; aquí sobrevive
 * para hacer el healthcheck y, si falla, el rollback. Es **one-shot**: corre la
 * secuencia una vez, escribe el resultado y sale → nunca entra en bucle de reinicio.
 *
 * La ejecución real (git/pnpm/systemctl) se verifica en el despliegue (US-86).
 */

import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UpdateResult } from '@krakenos/types';
import { ProcessUpdateRunner } from './system/process-update-runner.js';
import { orchestrateUpdate } from './system/update-orchestrator.js';
import { resolveDbFile } from './system/restore.js';

function readAgentVersion(): string {
  for (const rel of ['../package.json', '../../package.json']) {
    try {
      const path = fileURLToPath(new URL(rel, import.meta.url));
      const pkg = JSON.parse(readFileSync(path, 'utf8')) as { version?: string };
      if (pkg.version) return pkg.version;
    } catch {
      // siguiente candidato
    }
  }
  return '0.0.0';
}

async function main(): Promise<void> {
  const targetVersion = process.argv[2]?.replace(/^v/i, '') ?? '';
  const varDir = resolve('var');
  const lockFile = resolve(varDir, 'update.lock');
  const resultFile = resolve(varDir, 'update-result.json');
  const current = readAgentVersion();

  if (!targetVersion) {
    process.stderr.write('[update] Falta la versión objetivo\n');
    await rm(lockFile, { force: true });
    process.exit(1);
  }

  const port = Number(process.env.PORT ?? 3001);
  const runner = new ProcessUpdateRunner({
    repoDir: process.env.KRAKENOS_REPO_DIR ?? resolve('../..'),
    serviceName: process.env.KRAKENOS_SERVICE_NAME ?? 'krakenos',
    healthUrl: process.env.KRAKENOS_HEALTH_URL ?? `http://127.0.0.1:${port}/health/ready`,
    dbFile: resolveDbFile(process.env.DATABASE_URL ?? 'file:./dev.db'),
  });

  let result: UpdateResult;
  try {
    result = await orchestrateUpdate(runner, current, targetVersion, {
      onStep: (s) =>
        process.stdout.write(`[update] ${s.step}: ${s.status}${s.detail ? ` — ${s.detail}` : ''}\n`),
    });
  } catch (err) {
    // orchestrateUpdate no debería lanzar, pero si algo inesperado explota dejamos
    // constancia y limpiamos el lock igualmente.
    result = {
      ok: false,
      rolledBack: false,
      fromVersion: current,
      targetVersion,
      steps: [{ step: 'backup', status: 'failed', detail: err instanceof Error ? err.message : 'error' }],
      finishedAt: new Date().toISOString(),
    };
  }

  try {
    await mkdir(dirname(resultFile), { recursive: true });
    await writeFile(resultFile, JSON.stringify(result), 'utf8');
  } finally {
    await rm(lockFile, { force: true });
  }
  process.exit(result.ok ? 0 : 1);
}

void main();
