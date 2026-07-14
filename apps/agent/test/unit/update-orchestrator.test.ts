import { describe, expect, it, vi } from 'vitest';
import { orchestrateUpdate, type UpdateRunner } from '../../src/system/update-orchestrator.js';

/** Runner de prueba: todos los pasos OK salvo los que se marquen para fallar. */
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

const fixedNow = () => new Date('2026-07-13T10:00:00.000Z');

describe('orchestrateUpdate', () => {
  it('camino feliz: ejecuta todos los pasos en orden y no revierte', async () => {
    const runner = makeRunner();
    const result = await orchestrateUpdate(runner, '1.0.0', '1.1.0', { now: fixedNow });

    expect(result.ok).toBe(true);
    expect(result.rolledBack).toBe(false);
    expect(result.fromVersion).toBe('1.0.0');
    expect(result.targetVersion).toBe('1.1.0');
    expect(result.steps.map((s) => s.step)).toEqual([
      'backup',
      'fetch',
      'apply',
      'migrate',
      'restart',
      'healthcheck',
    ]);
    expect(result.steps.every((s) => s.status === 'ok')).toBe(true);
    expect(runner.fetch).toHaveBeenCalledWith('1.1.0');
    expect(runner.rollback).not.toHaveBeenCalled();
    expect(result.finishedAt).toBe('2026-07-13T10:00:00.000Z');
  });

  it('fallo en el backup: aborta SIN rollback (nada tocado todavía)', async () => {
    const runner = makeRunner({
      backup: vi.fn(async () => {
        throw new Error('disco lleno');
      }),
    });
    const result = await orchestrateUpdate(runner, '1.0.0', '1.1.0');

    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(false);
    expect(runner.rollback).not.toHaveBeenCalled();
    expect(runner.fetch).not.toHaveBeenCalled();
    const backup = result.steps.find((s) => s.step === 'backup');
    expect(backup).toMatchObject({ status: 'failed', detail: 'disco lleno' });
    // El resto de pasos quedan omitidos.
    expect(result.steps.filter((s) => s.status === 'skipped')).toHaveLength(5);
  });

  it('fallo en migrate (tras el backup): revierte y marca rolledBack', async () => {
    const runner = makeRunner({
      migrate: vi.fn(async () => {
        throw new Error('migración rota');
      }),
    });
    const result = await orchestrateUpdate(runner, '1.0.0', '1.1.0');

    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(runner.rollback).toHaveBeenCalledOnce();
    expect(result.steps.find((s) => s.step === 'migrate')).toMatchObject({
      status: 'failed',
      detail: 'migración rota',
    });
    // restart y healthcheck no llegan a ejecutarse.
    expect(runner.restart).not.toHaveBeenCalled();
    expect(runner.healthcheck).not.toHaveBeenCalled();
    expect(result.steps.find((s) => s.step === 'restart')).toMatchObject({ status: 'skipped' });
    expect(result.steps.find((s) => s.step === 'rollback')).toMatchObject({ status: 'ok' });
  });

  it('healthcheck que devuelve false: revierte (la nueva versión no responde sana)', async () => {
    const runner = makeRunner({ healthcheck: vi.fn(async () => false) });
    const result = await orchestrateUpdate(runner, '1.0.0', '1.1.0');

    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(runner.rollback).toHaveBeenCalledOnce();
    expect(result.steps.find((s) => s.step === 'healthcheck')?.status).toBe('failed');
  });

  it('si el propio rollback falla, lo refleja pero sigue siendo rolledBack:true', async () => {
    const runner = makeRunner({
      restart: vi.fn(async () => {
        throw new Error('systemctl no responde');
      }),
      rollback: vi.fn(async () => {
        throw new Error('rollback también falló');
      }),
    });
    const result = await orchestrateUpdate(runner, '1.0.0', '1.1.0');

    expect(result.ok).toBe(false);
    expect(result.rolledBack).toBe(true);
    expect(result.steps.find((s) => s.step === 'rollback')).toMatchObject({
      status: 'failed',
      detail: 'rollback también falló',
    });
  });

  it('invoca onStep por cada paso', async () => {
    const onStep = vi.fn();
    await orchestrateUpdate(makeRunner(), '1.0.0', '1.1.0', { onStep });
    expect(onStep).toHaveBeenCalledTimes(6);
    expect(onStep).toHaveBeenLastCalledWith({ step: 'healthcheck', status: 'ok' });
  });
});
