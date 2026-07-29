import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProcessUpdateRunner,
  type UpdateExec,
} from '../../src/system/process-update-runner.js';

function tmpDbFile(content = 'DB-ANTES'): string {
  const dir = mkdtempSync(join(tmpdir(), 'krakenos-upd-'));
  const db = join(dir, 'app.db');
  writeFileSync(db, content);
  return db;
}

/** Exec mock que registra las llamadas y responde a `git rev-parse HEAD`. */
function mockExec(): { exec: UpdateExec; calls: string[][] } {
  const calls: string[][] = [];
  const exec: UpdateExec = vi.fn(async (file: string, args: string[]) => {
    calls.push([file, ...args]);
    if (file === 'git' && args.includes('rev-parse') && args.includes('HEAD')) {
      return { stdout: 'abc1234\n', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  });
  return { exec, calls };
}

function make(opts: Partial<ConstructorParameters<typeof ProcessUpdateRunner>[0]> = {}) {
  const { exec, calls } = mockExec();
  const runner = new ProcessUpdateRunner({
    repoDir: '/opt/krakenos',
    serviceName: 'krakenos',
    healthUrl: 'http://127.0.0.1:3001/health/ready',
    dbFile: opts.dbFile ?? tmpDbFile(),
    exec,
    sleep: async () => undefined,
    ...opts,
  });
  return { runner, calls };
}

afterEach(() => vi.restoreAllMocks());

describe('ProcessUpdateRunner', () => {
  it('backup hace el snapshot de la DB y captura el commit actual', async () => {
    const dbFile = tmpDbFile('CONTENIDO-DB');
    const { runner, calls } = make({ dbFile });
    await runner.backup();

    expect(existsSync(`${dbFile}.pre-update`)).toBe(true);
    expect(readFileSync(`${dbFile}.pre-update`, 'utf8')).toBe('CONTENIDO-DB');
    expect(calls).toContainEqual(['git', '-C', '/opt/krakenos', 'rev-parse', 'HEAD']);
  });

  // US-232: con WAL (US-228) una copia del fichero principal a secas se deja atrás
  // lo que aún no se ha checkpointeado → el snapshot va por VACUUM INTO.
  it('backup usa el snapshot inyectado (VACUUM INTO en producción), no una copia', async () => {
    const dbFile = tmpDbFile('DB-VIVA');
    const dbSnapshot = vi.fn(async (src: string, dest: string) => {
      writeFileSync(dest, `SNAPSHOT-DE-${readFileSync(src, 'utf8')}`);
    });
    const { runner } = make({ dbFile, dbSnapshot });
    await runner.backup();
    expect(dbSnapshot).toHaveBeenCalledWith(dbFile, `${dbFile}.pre-update`);
    expect(readFileSync(`${dbFile}.pre-update`, 'utf8')).toBe('SNAPSHOT-DE-DB-VIVA');
  });

  it('fetch valida que la etiqueta existe', async () => {
    const { runner, calls } = make();
    await runner.fetch('1.2.0');
    expect(calls).toContainEqual(['git', '-C', '/opt/krakenos', 'fetch', '--tags', '--force']);
    expect(calls).toContainEqual([
      'git',
      '-C',
      '/opt/krakenos',
      'rev-parse',
      '--verify',
      'refs/tags/v1.2.0',
    ]);
  });

  it('apply hace checkout de la etiqueta objetivo y reconstruye', async () => {
    const { runner, calls } = make();
    await runner.fetch('1.2.0');
    await runner.apply();
    expect(calls).toContainEqual(['git', '-C', '/opt/krakenos', 'checkout', '--force', 'v1.2.0']);
    expect(calls.some((c) => c[0] === 'pnpm' && c.includes('build'))).toBe(true);
  });

  it('migrate ejecuta prisma migrate deploy', async () => {
    const { runner, calls } = make();
    await runner.migrate();
    expect(calls.some((c) => c.includes('prisma') && c.includes('migrate') && c.includes('deploy'))).toBe(
      true,
    );
  });

  it('restart usa sudo systemctl por defecto', async () => {
    const { runner, calls } = make();
    await runner.restart();
    expect(calls).toContainEqual(['sudo', '-n', 'systemctl', 'restart', 'krakenos']);
  });

  it('restart sin sudo cuando useSudo:false', async () => {
    const { runner, calls } = make({ useSudo: false });
    await runner.restart();
    expect(calls).toContainEqual(['systemctl', 'restart', 'krakenos']);
  });

  it('healthcheck reintenta y devuelve true cuando responde ok', async () => {
    let n = 0;
    const { runner } = make({
      fetchFn: async () => ({ ok: ++n >= 3 }), // sano al 3er intento
    });
    expect(await runner.healthcheck()).toBe(true);
    expect(n).toBe(3);
  });

  it('healthcheck devuelve false si nunca responde sano', async () => {
    const { runner } = make({ fetchFn: async () => ({ ok: false }) });
    expect(await runner.healthcheck()).toBe(false);
  });

  it('rollback restaura la DB previa, revierte el commit y arranca el servicio', async () => {
    const dbFile = tmpDbFile('DB-VIEJA');
    const { runner, calls } = make({ dbFile });
    await runner.backup(); // captura commit + snapshot pre-update
    writeFileSync(dbFile, 'DB-NUEVA-ROTA'); // simula que la migración la cambió
    await runner.rollback();

    expect(readFileSync(dbFile, 'utf8')).toBe('DB-VIEJA'); // restaurada
    expect(calls).toContainEqual(['git', '-C', '/opt/krakenos', 'checkout', '--force', 'abc1234']);
    expect(calls).toContainEqual(['sudo', '-n', 'systemctl', 'start', 'krakenos']);
  });

  // US-232: sobrescribir el .db con el agente vivo lo corrompe. El orden es
  // parar → restaurar → arrancar, no restaurar → reiniciar.
  it('rollback PARA el servicio antes de tocar la base y lo arranca después', async () => {
    const dbFile = tmpDbFile('DB-VIEJA');
    const { runner, calls } = make({ dbFile, useSudo: false });
    await runner.backup();
    await runner.rollback();

    const flat = calls.map((c) => c.join(' '));
    const stopAt = flat.indexOf('systemctl stop krakenos');
    const startAt = flat.indexOf('systemctl start krakenos');
    expect(stopAt, 'debe pararse el servicio en el rollback').toBeGreaterThanOrEqual(0);
    expect(startAt).toBeGreaterThan(stopAt);
    // El checkout de reversión ocurre con el servicio ya parado.
    expect(flat.findIndex((c) => c.includes('checkout --force abc1234'))).toBeGreaterThan(stopAt);
  });

  it('rollback descarta el WAL/SHM de la versión nueva (pertenecen a la base sustituida)', async () => {
    const dbFile = tmpDbFile('DB-VIEJA');
    writeFileSync(`${dbFile}-wal`, 'WAL-DE-LA-NUEVA');
    writeFileSync(`${dbFile}-shm`, 'SHM');
    const { runner } = make({ dbFile });
    await runner.backup();
    await runner.rollback();

    expect(existsSync(`${dbFile}-wal`)).toBe(false);
    expect(existsSync(`${dbFile}-shm`)).toBe(false);
  });
});

/**
 * Deps opcionales entre actualizaciones (AUD3-22): `pnpm install --frozen-lockfile`
 * poda node-ssh/mqtt/ws/net-snmp, así que el usuario perdía su router SSH o su
 * zigbee2mqtt en cada update, en silencio.
 */
describe('ProcessUpdateRunner — deps opcionales (US-232)', () => {
  function withManifest(content: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'krakenos-deps-'));
    const file = join(dir, 'extra-deps.json');
    writeFileSync(file, content);
    return file;
  }

  it('apply reinstala las deps del manifiesto tras el install/build', async () => {
    const { runner, calls } = make({
      extraDepsFile: withManifest('["node-ssh","mqtt"]'),
      agentDir: '/opt/krakenos/apps/agent',
    });
    await runner.fetch('1.2.0');
    await runner.apply();

    const flat = calls.map((c) => c.join(' '));
    expect(flat).toContain('pnpm --dir /opt/krakenos/apps/agent add node-ssh mqtt');
    // Y después del install congelado, que es justo lo que las poda.
    expect(flat.findIndex((c) => c.includes('add node-ssh'))).toBeGreaterThan(
      flat.findIndex((c) => c.includes('install --frozen-lockfile')),
    );
  });

  it('sin manifiesto no ejecuta ningún pnpm add', async () => {
    const { runner, calls } = make({ extraDepsFile: '/no/existe/extra-deps.json' });
    await runner.fetch('1.2.0');
    await runner.apply();
    expect(calls.some((c) => c.includes('add'))).toBe(false);
  });

  it('un manifiesto corrupto no rompe la actualización', async () => {
    const { runner, calls } = make({ extraDepsFile: withManifest('{ roto') });
    await runner.fetch('1.2.0');
    await expect(runner.apply()).resolves.toBeUndefined();
    expect(calls.some((c) => c.includes('add'))).toBe(false);
  });

  it('si el pnpm add falla, AVISA pero no tumba la actualización (ni provoca rollback)', async () => {
    const warn = vi.fn();
    const exec: UpdateExec = vi.fn(async (file: string, args: string[]) => {
      if (file === 'pnpm' && args.includes('add')) throw new Error('registry inalcanzable');
      if (file === 'git' && args.includes('rev-parse')) return { stdout: 'abc1234\n', stderr: '' };
      return { stdout: '', stderr: '' };
    });
    const runner = new ProcessUpdateRunner({
      repoDir: '/opt/krakenos',
      serviceName: 'krakenos',
      healthUrl: 'http://127.0.0.1:3001/health/ready',
      dbFile: tmpDbFile(),
      exec,
      warn,
      extraDepsFile: withManifest('["mqtt"]'),
      sleep: async () => undefined,
    });
    await runner.fetch('1.2.0');
    await expect(runner.apply()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('mqtt'));
    // El aviso dice qué hacer, no solo que falló.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('pnpm add mqtt'));
  });
});
