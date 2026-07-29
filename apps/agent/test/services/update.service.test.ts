import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UpdateStatus } from '@krakenos/types';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateChecker } from '../../src/system/update-check.js';
import { UpdateService } from '../../src/modules/system/update.service.js';

function tmpVar(): string {
  return mkdtempSync(join(tmpdir(), 'krakenos-svc-'));
}

/** Stub mínimo del comprobador de releases (US-116). */
function stubChecker(status: UpdateStatus): UpdateChecker {
  return { check: vi.fn(async () => status) } as unknown as UpdateChecker;
}

const AVAILABLE: UpdateStatus = { enabled: true, current: '1.0.0', latest: '1.1.0', updateAvailable: true };
const UP_TO_DATE: UpdateStatus = { enabled: true, current: '1.1.0', latest: '1.1.0', updateAvailable: false };
const DISABLED: UpdateStatus = { enabled: false, current: '1.0.0', latest: null, updateAvailable: false };

function make(opts: {
  status: UpdateStatus;
  mode?: 'systemd' | 'docker';
  window?: string;
  varDir?: string;
  now?: () => Date;
  /** ¿Vive el PID del lock? Inyectado para no depender de procesos reales. */
  isProcessAlive?: (pid: number) => boolean;
  /** PID que devuelve el spawner (se guarda en el lock, US-232). */
  spawnPid?: number;
}) {
  const spawn = vi.fn(() => opts.spawnPid);
  const varDir = opts.varDir ?? tmpVar();
  const service = new UpdateService({
    current: opts.status.current,
    mode: opts.mode ?? 'systemd',
    checker: stubChecker(opts.status),
    readMaintenanceWindow: async () => opts.window ?? '',
    spawn,
    varDir,
    now: opts.now,
    isProcessAlive: opts.isProcessAlive,
  });
  return { service, spawn, varDir };
}

/** Escribe un lock del formato actual (US-232) en `varDir`. */
function writeLock(varDir: string, lock: { version: string; pid: number; startedAt: string }): void {
  writeFileSync(join(varDir, 'update.lock'), `${JSON.stringify(lock)}\n`);
}

const LOCK_AT = '2026-07-29T12:00:00.000Z';
const liveLock = { version: '1.1.0', pid: 4242, startedAt: LOCK_AT };

describe('UpdateService.getPlan', () => {
  it('systemd: canSelfUpdate y sin comando docker', async () => {
    const { service } = make({ status: AVAILABLE });
    const plan = await service.getPlan();
    expect(plan.mode).toBe('systemd');
    expect(plan.canSelfUpdate).toBe(true);
    expect(plan.dockerCommand).toBeNull();
    expect(plan.updateAvailable).toBe(true);
    expect(plan.latest).toBe('1.1.0');
    expect(plan.inProgress).toBe(false);
    expect(plan.lastResult).toBeNull();
  });

  it('docker: no puede auto-actualizarse y ofrece el comando manual', async () => {
    const { service } = make({ status: AVAILABLE, mode: 'docker' });
    const plan = await service.getPlan();
    expect(plan.canSelfUpdate).toBe(false);
    expect(plan.dockerCommand).toContain('docker compose pull');
  });

  it('refleja la ventana de mantenimiento válida y descarta la basura', async () => {
    const { service } = make({ status: AVAILABLE, window: '02:00-04:00' });
    expect((await service.getPlan()).maintenanceWindow).toBe('02:00-04:00');
    const bad = make({ status: AVAILABLE, window: 'no-válido' });
    expect((await bad.service.getPlan()).maintenanceWindow).toBeNull();
  });

  it('inProgress:true con un lock VIVO; lastResult se lee del fichero (parseo defensivo)', async () => {
    const varDir = tmpVar();
    writeLock(varDir, liveLock);
    writeFileSync(
      join(varDir, 'update-result.json'),
      JSON.stringify({
        ok: true,
        rolledBack: false,
        fromVersion: '1.0.0',
        targetVersion: '1.1.0',
        steps: [{ step: 'backup', status: 'ok' }],
        finishedAt: '2026-07-13T10:00:00.000Z',
      }),
    );
    const { service } = make({
      status: AVAILABLE,
      varDir,
      isProcessAlive: () => true,
      now: () => new Date(Date.parse(LOCK_AT) + 1000),
    });
    const plan = await service.getPlan();
    expect(plan.inProgress).toBe(true);
    expect(plan.inProgressSince).toBe(LOCK_AT);
    expect(plan.lastResult?.ok).toBe(true);

    // JSON corrupto → lastResult null, sin tumbar el plan.
    writeFileSync(join(varDir, 'update-result.json'), '{ roto');
    expect((await service.getPlan()).lastResult).toBeNull();
  });

  it('un lock HUÉRFANO no cuenta como en curso (AUD3-20: el actualizador murió)', async () => {
    const varDir = tmpVar();
    writeLock(varDir, liveLock);
    const { service } = make({
      status: AVAILABLE,
      varDir,
      isProcessAlive: () => false,
      now: () => new Date(Date.parse(LOCK_AT) + 1000),
    });
    const plan = await service.getPlan();
    expect(plan.inProgress).toBe(false);
    expect(plan.inProgressSince).toBeNull();
  });

  it('un lock caducado por edad tampoco bloquea (actualizador atascado)', async () => {
    const varDir = tmpVar();
    writeLock(varDir, liveLock);
    const { service } = make({
      status: AVAILABLE,
      varDir,
      isProcessAlive: () => true,
      now: () => new Date(Date.parse(LOCK_AT) + 21 * 60 * 1000),
    });
    expect((await service.getPlan()).inProgress).toBe(false);
  });

  it('sin lock, inProgressSince es null', async () => {
    const { service } = make({ status: AVAILABLE });
    expect((await service.getPlan()).inProgressSince).toBeNull();
  });
});

describe('UpdateService.apply', () => {
  it('docker: no lanza nada, devuelve el comando manual', async () => {
    const { service, spawn } = make({ status: AVAILABLE, mode: 'docker' });
    const res = await service.apply();
    expect(res.started).toBe(false);
    expect(res.dockerCommand).toContain('docker compose pull');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('sin actualización disponible: no lanza', async () => {
    const { service, spawn } = make({ status: UP_TO_DATE });
    const res = await service.apply();
    expect(res.started).toBe(false);
    expect(res.message).toMatch(/última versión/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('comprobación desactivada: no lanza', async () => {
    const { service, spawn } = make({ status: DISABLED });
    const res = await service.apply();
    expect(res.started).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('ya en curso (lock VIVO): no lanza otro', async () => {
    const varDir = tmpVar();
    writeLock(varDir, liveLock);
    const { service, spawn } = make({
      status: AVAILABLE,
      varDir,
      isProcessAlive: () => true,
      now: () => new Date(Date.parse(LOCK_AT) + 1000),
    });
    const res = await service.apply();
    expect(res.started).toBe(false);
    expect(res.message).toMatch(/en curso/i);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('un lock huérfano NO deja la función inservible: se pisa y se relanza (AUD3-20)', async () => {
    const varDir = tmpVar();
    writeLock(varDir, liveLock);
    const { service, spawn } = make({
      status: AVAILABLE,
      varDir,
      isProcessAlive: () => false, // el actualizador murió en su propio restart
      now: () => new Date(Date.parse(LOCK_AT) + 1000),
      spawnPid: 777,
    });
    const res = await service.apply();
    expect(res.started).toBe(true);
    expect(spawn).toHaveBeenCalledWith('1.1.0');
  });

  it('guarda el PID que devuelve el spawner en el lock', async () => {
    const { service, varDir } = make({ status: AVAILABLE, spawnPid: 4321 });
    await service.apply();
    const raw = readFileSync(join(varDir, 'update.lock'), 'utf8');
    expect(JSON.parse(raw)).toMatchObject({ version: '1.1.0', pid: 4321 });
  });

  it('un spawner que no informa del PID deja el lock sin PID (caduca solo por TTL)', async () => {
    const { service, varDir } = make({ status: AVAILABLE });
    await service.apply();
    expect(JSON.parse(readFileSync(join(varDir, 'update.lock'), 'utf8'))).toMatchObject({ pid: 0 });
  });

  it('fuera de la ventana de mantenimiento: no lanza salvo force', async () => {
    const noon = () => new Date(2026, 6, 13, 12, 0);
    const blocked = make({ status: AVAILABLE, window: '02:00-04:00', now: noon });
    const res = await blocked.service.apply();
    expect(res.started).toBe(false);
    expect(res.message).toMatch(/ventana/i);
    expect(blocked.spawn).not.toHaveBeenCalled();

    // force salta la ventana.
    const forced = make({ status: AVAILABLE, window: '02:00-04:00', now: noon });
    const forcedRes = await forced.service.apply(true);
    expect(forcedRes.started).toBe(true);
    expect(forced.spawn).toHaveBeenCalledWith('1.1.0');
  });

  it('éxito: lanza el actualizador, escribe el lock y devuelve started', async () => {
    const { service, spawn, varDir } = make({ status: AVAILABLE });
    const res = await service.apply();
    expect(res.started).toBe(true);
    expect(res.message).toContain('1.1.0');
    expect(spawn).toHaveBeenCalledWith('1.1.0');
    expect(existsSync(join(varDir, 'update.lock'))).toBe(true);
  });

  it('si el spawn falla, borra el lock y no queda "en curso"', async () => {
    const varDir = tmpVar();
    const service = new UpdateService({
      current: '1.0.0',
      mode: 'systemd',
      checker: stubChecker(AVAILABLE),
      readMaintenanceWindow: async () => '',
      spawn: () => {
        throw new Error('exec falló');
      },
      varDir,
    });
    const res = await service.apply();
    expect(res.started).toBe(false);
    expect(res.message).toMatch(/no se pudo lanzar/i);
    expect(existsSync(join(varDir, 'update.lock'))).toBe(false);
  });
});

describe('UpdateService.cancel', () => {
  it('libera el lock y permite volver a intentarlo', async () => {
    const varDir = tmpVar();
    writeLock(varDir, liveLock);
    const { service, spawn } = make({
      status: AVAILABLE,
      varDir,
      isProcessAlive: () => true,
      now: () => new Date(Date.parse(LOCK_AT) + 1000),
    });
    // Con el lock vivo, apply() se niega…
    expect((await service.apply()).started).toBe(false);

    expect(await service.cancel()).toBe(true);
    expect(existsSync(join(varDir, 'update.lock'))).toBe(false);
    expect((await service.getPlan()).inProgress).toBe(false);

    // …y tras cancelar, sí lanza.
    expect((await service.apply()).started).toBe(true);
    expect(spawn).toHaveBeenCalledWith('1.1.0');
  });

  it('sin lock devuelve false (nada que cancelar)', async () => {
    const { service } = make({ status: AVAILABLE });
    expect(await service.cancel()).toBe(false);
  });
});
