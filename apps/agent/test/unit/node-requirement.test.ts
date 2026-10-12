import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { UpdateService } from '../../src/modules/system/update.service.js';
import type { UpdateChecker } from '../../src/system/update-check.js';
import {
  checkNodeRequirement,
  NODE_TOO_OLD,
  parseEnginesNode,
  parseNodeVersion,
  readEnginesNode,
  UpdateBlockedError,
} from '../../src/system/node-requirement.js';
import { ProcessUpdateRunner, type UpdateExec } from '../../src/system/process-update-runner.js';
import { orchestrateUpdate, type UpdateRunner } from '../../src/system/update-orchestrator.js';

describe('requisito de Node (puro)', () => {
  it('entiende versiones y rangos >=', () => {
    expect(parseNodeVersion('v24.15.0')).toEqual({ major: 24, minor: 15 });
    expect(parseNodeVersion('20')).toEqual({ major: 20, minor: 0 });
    expect(parseNodeVersion('basura')).toBeNull();
    expect(parseEnginesNode('>=24')).toEqual({ major: 24, minor: 0 });
    expect(parseEnginesNode(' >= 22.12.0 ')).toEqual({ major: 22, minor: 12 });
    expect(parseEnginesNode('^24')).toBeNull();
    expect(parseEnginesNode('>=20 <25')).toBeNull();
  });

  it('el destino exige 24 y el sistema tiene 20 → no cumple, con el mensaje exacto', () => {
    const r = checkNodeRequirement('>=24', 'v20.19.0');
    expect(r).toEqual({
      ok: false,
      required: '24',
      current: '20.19',
      message:
        'Esta versión necesita Node 24 o superior y el sistema tiene 20.19. ' +
        'Actualiza con `sudo bash scripts/install.sh --update`, que instala el Node necesario.',
    });
  });

  it('compara también el menor: >=22.12 con 22.5 no cumple y con 22.12 sí', () => {
    expect(checkNodeRequirement('>=22.12.0', 'v22.5.0').ok).toBe(false);
    expect(checkNodeRequirement('>=22.12.0', 'v22.12.1').ok).toBe(true);
  });

  it('cumple con un Node igual o mayor', () => {
    expect(checkNodeRequirement('>=20', 'v24.15.0').ok).toBe(true);
    expect(checkNodeRequirement('>=24', 'v24.0.0').ok).toBe(true);
  });

  it('lo que no sabe interpretar NO bloquea', () => {
    expect(checkNodeRequirement(undefined, 'v20.0.0').ok).toBe(true);
    expect(checkNodeRequirement('^24 || ^26', 'v20.0.0').ok).toBe(true);
    expect(checkNodeRequirement('>=24', 'raro').ok).toBe(true);
    expect(readEnginesNode('{no es json')).toBeNull();
    expect(readEnginesNode('{"engines":{"node":">=24"}}')).toBe('>=24');
    expect(readEnginesNode('{"name":"x"}')).toBeNull();
  });
});

describe('el actualizador se niega a aplicar una versión que exige más Node', () => {
  function makeRunner(overrides: Partial<UpdateRunner> = {}): UpdateRunner {
    return {
      backup: vi.fn(async () => undefined),
      fetch: vi.fn(async () => undefined),
      apply: vi.fn(async () => undefined),
      migrate: vi.fn(async () => undefined),
      restart: vi.fn(async () => undefined),
      healthcheck: vi.fn(async () => true),
      rollback: vi.fn(async () => undefined),
      ...overrides,
    };
  }

  /** Runner real con git simulado: el tag de destino declara `engines.node`. */
  function realRunner(engines: string, nodeVersion: string) {
    const calls: string[][] = [];
    const exec: UpdateExec = vi.fn(async (file, args) => {
      calls.push([file, ...args]);
      if (file === 'git' && args.includes('show')) {
        return { stdout: JSON.stringify({ engines: { node: engines } }), stderr: '' };
      }
      if (file === 'git' && args.includes('HEAD')) return { stdout: 'abc\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const runner = new ProcessUpdateRunner({
      repoDir: '/opt/krakenos',
      serviceName: 'krakenos',
      healthUrl: 'http://127.0.0.1:3001/health/ready',
      dbFile: '/tmp/no-se-usa.db',
      exec,
      nodeVersion,
      fetchFn: async () => ({ ok: true }),
      sleep: async () => undefined,
      dbSnapshot: async () => undefined,
    });
    return { runner, calls };
  }

  it('orquestador: un fetch bloqueado aborta SIN apply ni rollback', async () => {
    const runner = makeRunner({
      fetch: vi.fn(async () => {
        throw new UpdateBlockedError(NODE_TOO_OLD, 'necesita Node 24');
      }),
    });
    const result = await orchestrateUpdate(runner, '0.1.0', '0.2.0');

    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(false);
    expect(runner.apply).not.toHaveBeenCalled();
    expect(runner.restart).not.toHaveBeenCalled();
    expect(runner.rollback).not.toHaveBeenCalled();
    expect(result.steps.find((s) => s.step === 'fetch')).toMatchObject({
      status: 'failed',
      code: 'NODE_TOO_OLD',
      detail: 'necesita Node 24',
    });
  });

  it('un fallo de fetch que NO es un bloqueo sigue revirtiendo como siempre', async () => {
    const runner = makeRunner({
      fetch: vi.fn(async () => {
        throw new Error('sin red');
      }),
    });
    const result = await orchestrateUpdate(runner, '0.1.0', '0.2.0');
    expect(result.rolledBack).toBe(true);
    expect(runner.rollback).toHaveBeenCalledOnce();
  });

  it('runner real: destino exige 24 y el sistema tiene 20 → aborta antes de apply', async () => {
    const { runner, calls } = realRunner('>=24', 'v20.19.0');
    const apply = vi.spyOn(runner, 'apply');
    const result = await orchestrateUpdate(runner, '0.1.0', '0.2.0');

    expect(apply).not.toHaveBeenCalled();
    expect(calls.some((c) => c.includes('checkout'))).toBe(false);
    expect(calls.some((c) => c[0] === 'pnpm' || c[0] === 'sudo')).toBe(false);
    expect(result.rolledBack).toBe(false);
    const fetchStep = result.steps.find((s) => s.step === 'fetch');
    expect(fetchStep?.code).toBe('NODE_TOO_OLD');
    expect(fetchStep?.detail).toContain('Esta versión necesita Node 24 o superior');
    // Lee el package.json del TAG de destino, no el del checkout actual.
    expect(calls).toContainEqual(['git', '-C', '/opt/krakenos', 'show', 'v0.2.0:package.json']);
  });

  it('runner real: destino exige 20 y el sistema tiene 24 → sigue adelante', async () => {
    const { runner } = realRunner('>=20', 'v24.15.0');
    const result = await orchestrateUpdate(runner, '0.1.0', '0.2.0');
    expect(result.steps.find((s) => s.step === 'fetch')?.status).toBe('ok');
    expect(result.steps.find((s) => s.step === 'apply')?.status).toBe('ok');
  });
});

describe('UpdateService anticipa el requisito de Node', () => {
  function service(engines: string | null, nodeVersion: string) {
    const spawn = vi.fn(() => undefined);
    const svc = new UpdateService({
      current: '0.1.0',
      mode: 'systemd',
      checker: {
        check: vi.fn(async () => ({
          enabled: true,
          current: '0.1.0',
          latest: '0.2.0',
          updateAvailable: true,
        })),
      } as unknown as UpdateChecker,
      readMaintenanceWindow: async () => '',
      spawn,
      varDir: mkdtempSync(join(tmpdir(), 'krakenos-node-')),
      nodeVersion,
      readTargetPackageJson: async () =>
        engines === null ? null : JSON.stringify({ engines: { node: engines } }),
    });
    return { svc, spawn };
  }

  it('el plan marca la versión como bloqueada y apply() no lanza nada', async () => {
    const { svc, spawn } = service('>=24', 'v20.19.0');
    const plan = await svc.getPlan();
    expect(plan.blockedReason).toBe('NODE_TOO_OLD');
    expect(plan.requiredNode).toBe('24');
    const res = await svc.apply();
    expect(res.started).toBe(false);
    expect(res.message).toContain('Node 24 o superior');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('con Node suficiente, o sin dato del tag, no bloquea', async () => {
    const ok = service('>=24', 'v24.15.0');
    expect((await ok.svc.getPlan()).blockedReason).toBeNull();
    expect((await ok.svc.apply()).started).toBe(true);
    const unknown = service(null, 'v20.19.0');
    expect((await unknown.svc.getPlan()).blockedReason).toBeNull();
  });
});
