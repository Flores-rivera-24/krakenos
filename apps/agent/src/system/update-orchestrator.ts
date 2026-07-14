/**
 * Orquestador de la actualización one-click con rollback (US-190).
 *
 * Es el **contrato puro** de la secuencia de actualización, con un `UpdateRunner`
 * **inyectable** (patrón mock-first, como los drivers/managers): así la lógica de
 * secuencia + decisión de rollback se testea sin tocar `git`/`systemctl`/`prisma`.
 * El runner real (`ProcessUpdateRunner`) mapea cada paso a comandos del sistema.
 *
 * Corre en un **proceso actualizador aparte** (`update-runner.ts`, lanzado detached
 * por el servicio), NO dentro del proceso del agente: así el paso `restart` puede
 * reiniciar el servicio sin matar al propio orquestador, que sigue vivo para hacer
 * el healthcheck y, si falla, el rollback. Es one-shot → **nunca entra en bucle de
 * reinicio** (a diferencia de un supervisor que reintentara).
 *
 * Secuencia: backup → fetch → apply → migrate → restart → healthcheck.
 *  - Cualquier fallo **después** del backup dispara `rollback` (restaura DB/versión
 *    previas y reinicia) y el resultado queda `rolledBack:true`.
 *  - Un fallo en el propio `backup` aborta sin rollback (no hay nada que revertir y
 *    no se ha tocado nada todavía).
 */

import type { UpdateResult, UpdateStep, UpdateStepResult } from '@krakenos/types';

/**
 * Ejecuta cada fase de la actualización. Implementaciones: `ProcessUpdateRunner`
 * (real, comandos del sistema) y mocks en tests. Todos los métodos pueden lanzar;
 * el orquestador captura y decide el rollback.
 */
export interface UpdateRunner {
  /** Snapshot de seguridad previo (copia la DB actual + registra la versión viva). */
  backup(): Promise<void>;
  /** Descarga/prepara la release `targetVersion` en un área de staging. */
  fetch(targetVersion: string): Promise<void>;
  /** Coloca la nueva versión en su sitio (swap de artefactos). */
  apply(): Promise<void>;
  /** Aplica las migraciones de base de datos de la nueva versión. */
  migrate(): Promise<void>;
  /** Reinicia el servicio para que arranque con la nueva versión. */
  restart(): Promise<void>;
  /** Comprueba que la nueva versión responde sana (`/health/ready`). */
  healthcheck(): Promise<boolean>;
  /** Revierte a la versión previa (restaura DB + artefactos) y reinicia. */
  rollback(): Promise<void>;
}

export interface OrchestrateOptions {
  /** Callback por paso (para log/telemetría en vivo). No debe lanzar. */
  onStep?: (result: UpdateStepResult) => void;
  /** Reloj inyectable para el timestamp final (tests). */
  now?: () => Date;
}

/** Pasos de avance en orden (el `rollback` es reactivo, no va en la lista). */
const FORWARD_STEPS = ['backup', 'fetch', 'apply', 'migrate', 'restart', 'healthcheck'] as const;

/**
 * Orquesta una actualización a `targetVersion`. Nunca lanza: siempre devuelve un
 * `UpdateResult` con el detalle por paso (para escribirlo a disco y mostrarlo).
 */
export async function orchestrateUpdate(
  runner: UpdateRunner,
  fromVersion: string,
  targetVersion: string,
  opts: OrchestrateOptions = {},
): Promise<UpdateResult> {
  const now = opts.now ?? (() => new Date());
  const steps: UpdateStepResult[] = [];

  const record = (result: UpdateStepResult): void => {
    steps.push(result);
    opts.onStep?.(result);
  };

  const finish = (ok: boolean, rolledBack: boolean): UpdateResult => ({
    ok,
    rolledBack,
    fromVersion,
    targetVersion,
    steps,
    finishedAt: now().toISOString(),
  });

  // Ejecuta un paso de avance concreto (lanza si falla).
  const runForward = async (step: (typeof FORWARD_STEPS)[number]): Promise<void> => {
    switch (step) {
      case 'backup':
        return runner.backup();
      case 'fetch':
        return runner.fetch(targetVersion);
      case 'apply':
        return runner.apply();
      case 'migrate':
        return runner.migrate();
      case 'restart':
        return runner.restart();
      case 'healthcheck': {
        const healthy = await runner.healthcheck();
        if (!healthy) throw new Error('la nueva versión no superó el healthcheck');
        return;
      }
    }
  };

  // Fase de avance. El backup es el primer paso y la frontera del rollback: si el
  // backup falla no hay nada que revertir; si falla cualquier paso posterior, sí.
  let backedUp = false;
  for (let i = 0; i < FORWARD_STEPS.length; i++) {
    const step = FORWARD_STEPS[i]!;
    try {
      await runForward(step);
      record({ step, status: 'ok' });
      if (step === 'backup') backedUp = true;
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'error desconocido';
      record({ step, status: 'failed', detail });
      // Los pasos de avance restantes quedan omitidos.
      for (const rest of FORWARD_STEPS.slice(i + 1)) {
        record({ step: rest as UpdateStep, status: 'skipped' });
      }

      if (!backedUp) {
        // Falló el backup mismo → abortar sin rollback (nada tocado todavía).
        return finish(false, false);
      }

      // Falló un paso tras el backup → revertir a la versión previa.
      try {
        await runner.rollback();
        record({ step: 'rollback', status: 'ok' });
      } catch (rbErr) {
        record({
          step: 'rollback',
          status: 'failed',
          detail: rbErr instanceof Error ? rbErr.message : 'error desconocido',
        });
      }
      return finish(false, true);
    }
  }

  return finish(true, false);
}
