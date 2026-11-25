import { describe, expect, it, vi } from 'vitest';
import {
  PrivilegedCommandError,
  SudoHelperRunner,
  type ExecFn,
} from '../../src/privileged/runner.js';

const HELPER = '/usr/local/bin/krakenos-helper';

describe('SudoHelperRunner', () => {
  it('invoca el helper con `sudo -n` y los argv del comando', async () => {
    const exec = vi.fn<ExecFn>(async () => ({ stdout: 'ok', stderr: '', code: 0 }));
    const runner = new SudoHelperRunner({ helperPath: HELPER, exec });

    const res = await runner.run(['wg', 'show', 'wg0', 'public-key']);
    expect(res.stdout).toBe('ok');
    expect(exec).toHaveBeenCalledWith('sudo', ['-n', HELPER, 'wg', 'show', 'wg0', 'public-key']);
  });

  it('invoca el helper directamente cuando useSudo es false', async () => {
    const exec = vi.fn<ExecFn>(async () => ({ stdout: '', stderr: '', code: 0 }));
    const runner = new SudoHelperRunner({ helperPath: HELPER, useSudo: false, exec });

    await runner.run(['wg', 'set', 'wg0', 'peer', 'PK', 'remove']);
    expect(exec).toHaveBeenCalledWith(HELPER, ['wg', 'set', 'wg0', 'peer', 'PK', 'remove']);
  });

  it('pasa el tope de tiempo configurado (pkg-update tarda más que los 15 s de siempre)', async () => {
    const exec = vi.fn<ExecFn>(async () => ({ stdout: '', stderr: '', code: 0 }));
    await new SudoHelperRunner({ helperPath: HELPER, exec, timeoutMs: 1_200_000 }).run([
      'pkg-update',
    ]);
    expect(exec).toHaveBeenCalledWith('sudo', ['-n', HELPER, 'pkg-update'], 1_200_000);
  });

  it('lanza PrivilegedCommandError si el código de salida no es 0', async () => {
    const exec: ExecFn = async () => ({ stdout: '', stderr: 'denegado', code: 64 });
    const runner = new SudoHelperRunner({ helperPath: HELPER, exec });

    await expect(runner.run(['wg', 'badsub'])).rejects.toBeInstanceOf(PrivilegedCommandError);
  });
});
