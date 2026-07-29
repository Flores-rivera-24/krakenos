import type { IotDevice, IotManager } from '@krakenos/types';
import { describe, expect, it, vi } from 'vitest';
import { withDeviceCache } from '../../src/iot/device-cache.js';

/**
 * US-229 / AUD3-18: `listDevices()` no tenía caché y lo llamaban cinco
 * consumidores de fondo. Con la alarma armada eran ~71 sondeos/minuto al
 * hardware IoT para pedir siempre la misma lista.
 */

function fakeIot(devices: IotDevice[] = []): IotManager & { calls: () => number } {
  let calls = 0;
  return {
    listDevices: async () => {
      calls += 1;
      return devices;
    },
    getDevice: async (id) => devices.find((d) => d.id === id) ?? null,
    setState: async (id) => ({ ...devices.find((d) => d.id === id)! }),
    calls: () => calls,
  };
}

const LAMP: IotDevice = {
  id: 'lamp',
  name: 'Lámpara',
  kind: 'light',
  on: false,
  reachable: true,
};

describe('withDeviceCache (US-229)', () => {
  it('reutiliza la instantánea dentro del TTL y vuelve a preguntar al expirar', async () => {
    const iot = fakeIot([LAMP]);
    let now = 1_000;
    const cached = withDeviceCache(iot, { ttlMs: 5_000, now: () => now });

    await cached.listDevices();
    await cached.listDevices();
    now += 4_999;
    await cached.listDevices();
    expect(iot.calls()).toBe(1);

    now += 2; // fuera del TTL
    await cached.listDevices();
    expect(iot.calls()).toBe(2);
  });

  it('single-flight: N llamadas concurrentes comparten una sola lectura', async () => {
    let resolve!: (devices: IotDevice[]) => void;
    let calls = 0;
    const iot: IotManager = {
      listDevices: () => {
        calls += 1;
        return new Promise<IotDevice[]>((r) => {
          resolve = r;
        });
      },
      getDevice: async () => null,
      setState: async () => LAMP,
    };
    const cached = withDeviceCache(iot);

    const all = Promise.all([cached.listDevices(), cached.listDevices(), cached.listDevices()]);
    resolve([LAMP]);
    const results = await all;

    expect(calls).toBe(1);
    expect(results.every((r) => r[0]?.id === 'lamp')).toBe(true);
  });

  it('setState invalida la instantánea (si no, el watcher vería un estado fantasma)', async () => {
    const iot = fakeIot([LAMP]);
    const cached = withDeviceCache(iot, { ttlMs: 60_000 });

    await cached.listDevices();
    await cached.setState('lamp', { on: true });
    await cached.listDevices();

    expect(iot.calls()).toBe(2);
  });

  it('un fallo no se cachea: el ciclo siguiente vuelve a intentarlo', async () => {
    const listDevices = vi
      .fn<[], Promise<IotDevice[]>>()
      .mockRejectedValueOnce(new Error('bridge caído'))
      .mockResolvedValue([LAMP]);
    const cached = withDeviceCache({
      listDevices,
      getDevice: async () => null,
      setState: async () => LAMP,
    });

    await expect(cached.listDevices()).rejects.toThrow('bridge caído');
    await expect(cached.listDevices()).resolves.toHaveLength(1);
    expect(listDevices).toHaveBeenCalledTimes(2);
  });

  it('getDevice no pasa por la caché (estado real de un aparato concreto)', async () => {
    const getDevice = vi.fn().mockResolvedValue(LAMP);
    const cached = withDeviceCache({ listDevices: async () => [LAMP], getDevice, setState: async () => LAMP });

    await cached.getDevice('lamp');
    await cached.getDevice('lamp');

    expect(getDevice).toHaveBeenCalledTimes(2);
  });
});
