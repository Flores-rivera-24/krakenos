import { describe, expect, it, vi } from 'vitest';
import { isNewer, parseVersion, UpdateChecker } from '../../src/system/update-check.js';

describe('parseVersion', () => {
  it('parsea con y sin prefijo v', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('1.2.3')).toEqual([1, 2, 3]);
  });

  it('trata las partes no numéricas o ausentes como 0', () => {
    expect(parseVersion('1.2')).toEqual([1, 2, 0]);
    expect(parseVersion('1')).toEqual([1, 0, 0]);
    expect(parseVersion('x.y.z')).toEqual([0, 0, 0]);
    expect(parseVersion('')).toEqual([0, 0, 0]);
  });
});

describe('isNewer', () => {
  it('compara por major, minor y patch', () => {
    expect(isNewer('1.2.4', '1.2.3')).toBe(true);
    expect(isNewer('1.3.0', '1.2.9')).toBe(true);
    expect(isNewer('2.0.0', '1.9.9')).toBe(true);
    expect(isNewer('1.2.3', '1.2.3')).toBe(false);
    expect(isNewer('1.2.2', '1.2.3')).toBe(false);
    expect(isNewer('v1.2.4', '1.2.3')).toBe(true);
  });
});

const fetchOk = (tag: string) =>
  vi.fn(async () => ({ ok: true, json: async () => ({ tag_name: tag }) }));

describe('UpdateChecker', () => {
  it('sin repo → enabled:false y no llama a fetch', async () => {
    const fetchFn = vi.fn();
    const checker = new UpdateChecker('1.0.0', null, fetchFn);
    const status = await checker.check();
    expect(status).toEqual({ enabled: false, current: '1.0.0', latest: null, updateAvailable: false });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('release más nueva → updateAvailable', async () => {
    const fetchFn = fetchOk('v1.1.0');
    const checker = new UpdateChecker('1.0.0', 'owner/repo', fetchFn);
    const status = await checker.check();
    expect(status).toEqual({ enabled: true, current: '1.0.0', latest: '1.1.0', updateAvailable: true });
    expect(fetchFn).toHaveBeenCalledWith('https://api.github.com/repos/owner/repo/releases/latest');
  });

  it('misma versión → sin actualización', async () => {
    const checker = new UpdateChecker('1.0.0', 'owner/repo', fetchOk('1.0.0'));
    expect((await checker.check()).updateAvailable).toBe(false);
  });

  it('respuesta no-ok → latest null sin lanzar', async () => {
    const checker = new UpdateChecker('1.0.0', 'owner/repo', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    const status = await checker.check();
    expect(status).toEqual({ enabled: true, current: '1.0.0', latest: null, updateAvailable: false });
  });

  it('fetch que lanza → degrada a latest null', async () => {
    const checker = new UpdateChecker('1.0.0', 'owner/repo', vi.fn(async () => { throw new Error('network'); }));
    expect((await checker.check()).latest).toBeNull();
  });

  it('cachea el resultado durante 1 h (no vuelve a llamar fetch)', async () => {
    const fetchFn = fetchOk('1.1.0');
    let t = 1_000;
    const checker = new UpdateChecker('1.0.0', 'owner/repo', fetchFn, () => t);
    await checker.check();
    t += 30 * 60 * 1000; // 30 min después
    await checker.check();
    expect(fetchFn).toHaveBeenCalledTimes(1);
    t += 40 * 60 * 1000; // pasada 1 h total → refresca
    await checker.check();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
