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

    const res = await runner.run(['wg', 'show', 'wg0', 'dump']);
    expect(res.stdout).toBe('ok');
    expect(exec).toHaveBeenCalledWith('sudo', ['-n', HELPER, 'wg', 'show', 'wg0', 'dump']);
  });

  it('invoca el helper directamente cuando useSudo es false', async () => {
    const exec = vi.fn<ExecFn>(async () => ({ stdout: '', stderr: '', code: 0 }));
    const runner = new SudoHelperRunner({ helperPath: HELPER, useSudo: false, exec });

    await runner.run(['wg', 'set', 'wg0', 'peer', 'PK', 'remove']);
    expect(exec).toHaveBeenCalledWith(HELPER, ['wg', 'set', 'wg0', 'peer', 'PK', 'remove']);
  });

  it('lanza PrivilegedCommandError si el código de salida no es 0', async () => {
    const exec: ExecFn = async () => ({ stdout: '', stderr: 'denegado', code: 64 });
    const runner = new SudoHelperRunner({ helperPath: HELPER, exec });

    await expect(runner.run(['wg', 'badsub'])).rejects.toBeInstanceOf(PrivilegedCommandError);
  });
});
