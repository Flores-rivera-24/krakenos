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
  it('backup copia la DB a <db>.pre-update y captura el commit actual', async () => {
    const dbFile = tmpDbFile('CONTENIDO-DB');
    const { runner, calls } = make({ dbFile });
    await runner.backup();

    expect(existsSync(`${dbFile}.pre-update`)).toBe(true);
    expect(readFileSync(`${dbFile}.pre-update`, 'utf8')).toBe('CONTENIDO-DB');
    expect(calls).toContainEqual(['git', '-C', '/opt/krakenos', 'rev-parse', 'HEAD']);
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

  it('rollback restaura la DB previa, revierte el commit y reinicia', async () => {
    const dbFile = tmpDbFile('DB-VIEJA');
    const { runner, calls } = make({ dbFile });
    await runner.backup(); // captura commit + copia pre-update
    writeFileSync(dbFile, 'DB-NUEVA-ROTA'); // simula que la migración la cambió
    await runner.rollback();

    expect(readFileSync(dbFile, 'utf8')).toBe('DB-VIEJA'); // restaurada
    expect(calls).toContainEqual(['git', '-C', '/opt/krakenos', 'checkout', '--force', 'abc1234']);
    expect(calls).toContainEqual(['sudo', '-n', 'systemctl', 'restart', 'krakenos']);
  });
});
