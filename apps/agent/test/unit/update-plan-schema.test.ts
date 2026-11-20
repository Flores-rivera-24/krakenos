import type { UpdatePlan } from '@krakenos/types';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { updatePlanSchema } from '../../src/modules/system/system.schemas.js';

// `additionalProperties: false` / el schema de respuesta PODA en silencio lo que no declara:
// compara lo SERVIDO, no lo que el servicio construye.
describe('schema de GET /update/plan', () => {
  it('el código NO_PREVIOUS_PACKAGE de un paso llega al cliente', async () => {
    const plan: UpdatePlan = {
      enabled: true,
      current: '0.2.0',
      latest: '0.3.0',
      updateAvailable: true,
      mode: 'package',
      canSelfUpdate: true,
      dockerCommand: null,
      inProgress: false,
      inProgressSince: null,
      maintenanceWindow: null,
      blockedReason: null,
      requiredNode: null,
      helperReady: true,
      lastResult: {
        ok: false,
        rolledBack: false,
        fromVersion: '0.2.0',
        targetVersion: '0.3.0',
        steps: [{ step: 'rollback', status: 'failed', detail: 'x', code: 'NO_PREVIOUS_PACKAGE' }],
        finishedAt: '2026-07-13T10:00:00.000Z',
      },
    };
    const app = Fastify();
    app.get('/plan', { schema: updatePlanSchema }, () => plan);
    const res = await app.inject({ method: 'GET', url: '/plan' });
    expect(res.json()).toEqual(plan);
    await app.close();
  });
});
