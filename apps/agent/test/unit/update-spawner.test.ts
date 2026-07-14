import { describe, expect, it, vi } from 'vitest';

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawn: spawnMock }));

import { createUpdateSpawner } from '../../src/system/update-spawner.js';

/**
 * US-190/US-219: el spawner del actualizador debe lanzar `update-runner.js` como
 * proceso **detached** (sobrevive al reinicio del agente) y hacer `unref()`.
 */
describe('createUpdateSpawner (US-190)', () => {
  it('lanza el actualizador detached, con la versión y hace unref', () => {
    const unref = vi.fn();
    spawnMock.mockReturnValue({ unref });

    createUpdateSpawner()('1.2.3');

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = spawnMock.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(cmd).toBe(process.execPath);
    expect(args[0]).toMatch(/update-runner\.js$/);
    expect(args[1]).toBe('1.2.3');
    expect(opts).toMatchObject({ detached: true, stdio: 'ignore' });
    expect(unref).toHaveBeenCalledTimes(1);
  });
});
