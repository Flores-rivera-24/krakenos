import type { HardwareDriver } from '@krakenos/types';
import { describe, expect, it, vi } from 'vitest';
import {
  collectSignalByMac,
  createSignalCollector,
  worstSignalByRoom,
} from '../../src/modules/interop/room-signal.js';

const ROOMS = [
  { id: 'salon', name: 'Salón' },
  { id: 'buhardilla', name: 'Buhardilla' },
];

describe('worstSignalByRoom (US-236)', () => {
  it('devuelve la PEOR señal de la habitación, no la media ni la mejor', () => {
    const out = worstSignalByRoom(
      ROOMS,
      [
        { mac: 'aa:aa:aa:aa:aa:aa', roomId: 'salon', online: true },
        { mac: 'bb:bb:bb:bb:bb:bb', roomId: 'salon', online: true },
      ],
      new Map([
        ['aa:aa:aa:aa:aa:aa', -45],
        ['bb:bb:bb:bb:bb:bb', -78], // el peor servido manda
      ]),
    );
    expect(out.find((r) => r.id === 'salon')?.worstDbm).toBe(-78);
  });

  it('una habitación sin aparatos WiFi devuelve null, NUNCA 0 ni -100 inventado', () => {
    const out = worstSignalByRoom(ROOMS, [], new Map());
    expect(out.map((r) => r.worstDbm)).toEqual([null, null]);
  });

  it('ignora los aparatos desconectados: publicar su última señal sería mentir', () => {
    const out = worstSignalByRoom(
      ROOMS,
      [
        { mac: 'aa:aa:aa:aa:aa:aa', roomId: 'salon', online: true },
        { mac: 'bb:bb:bb:bb:bb:bb', roomId: 'salon', online: false }, // apagado
      ],
      new Map([
        ['aa:aa:aa:aa:aa:aa', -50],
        ['bb:bb:bb:bb:bb:bb', -90],
      ]),
    );
    expect(out.find((r) => r.id === 'salon')?.worstDbm).toBe(-50);
  });

  it('ignora los aparatos sin habitación asignada y los que no ve ningún AP', () => {
    const out = worstSignalByRoom(
      ROOMS,
      [
        { mac: 'aa:aa:aa:aa:aa:aa', roomId: null, online: true }, // sin habitación
        { mac: 'cc:cc:cc:cc:cc:cc', roomId: 'salon', online: true }, // por cable
      ],
      new Map([['aa:aa:aa:aa:aa:aa', -40]]),
    );
    expect(out.find((r) => r.id === 'salon')?.worstDbm).toBeNull();
  });

  it('compara la MAC sin distinguir mayúsculas (los drivers no coinciden entre sí)', () => {
    const out = worstSignalByRoom(
      ROOMS,
      [{ mac: 'AA:BB:CC:DD:EE:FF', roomId: 'salon', online: true }],
      new Map([['aa:bb:cc:dd:ee:ff', -61]]),
    );
    expect(out.find((r) => r.id === 'salon')?.worstDbm).toBe(-61);
  });
});

/** Driver falso: solo lo que usa `collectSignalByMac`. */
function fakeDriver(overrides: Partial<HardwareDriver>): HardwareDriver {
  return {
    listWifiNetworks: vi.fn(async () => []),
    listNetworkClients: vi.fn(async () => []),
    ...overrides,
  } as unknown as HardwareDriver;
}

describe('collectSignalByMac (US-236)', () => {
  it('recorre las redes UNA vez y se queda con el AP que mejor oye a cada aparato', async () => {
    const driver = fakeDriver({
      listWifiNetworks: vi.fn(async () => [{ id: 'ap1' }, { id: 'ap2' }] as never),
      listNetworkClients: vi.fn(async (id: string) =>
        (id === 'ap1'
          ? [{ mac: 'AA:AA:AA:AA:AA:AA', hostname: null, ip: '10.0.0.2', signalDbm: -70 }]
          : [{ mac: 'aa:aa:aa:aa:aa:aa', hostname: null, ip: '10.0.0.2', signalDbm: -55 }]) as never,
      ),
    });
    const out = await collectSignalByMac(driver);
    expect(out.get('aa:aa:aa:aa:aa:aa')).toBe(-55);
    // Una pasada por red, no una por dispositivo.
    expect(driver.listWifiNetworks).toHaveBeenCalledTimes(1);
    expect(driver.listNetworkClients).toHaveBeenCalledTimes(2);
  });

  it('un driver sin WiFi (pfSense) no rompe la publicación: mapa vacío', async () => {
    const driver = fakeDriver({
      listWifiNetworks: vi.fn(async () => {
        throw new Error('WiFi no soportado');
      }),
    });
    await expect(collectSignalByMac(driver)).resolves.toEqual(new Map());
  });

  it('el recolector cachea: la publicación no interroga al router en cada tick', async () => {
    let t = 0;
    const driver = fakeDriver({
      listWifiNetworks: vi.fn(async () => [{ id: 'ap1' }] as never),
      listNetworkClients: vi.fn(async () =>
        [{ mac: 'aa:aa:aa:aa:aa:aa', hostname: null, ip: '10.0.0.2', signalDbm: -50 }] as never,
      ),
    });
    const col = createSignalCollector(driver, { ttlMs: 60_000, now: () => t });

    await col.get();
    await col.get();
    await col.get();
    // Tres publicaciones seguidas, UN solo barrido al router (US-229).
    expect(driver.listWifiNetworks).toHaveBeenCalledTimes(1);

    t += 60_001; // vence el TTL
    await col.get();
    expect(driver.listWifiNetworks).toHaveBeenCalledTimes(2);
  });

  it('single-flight: dos ticks solapados no disparan dos barridos', async () => {
    const driver = fakeDriver({
      listWifiNetworks: vi.fn(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return [] as never;
      }),
    });
    const col = createSignalCollector(driver);
    await Promise.all([col.get(), col.get(), col.get()]);
    expect(driver.listWifiNetworks).toHaveBeenCalledTimes(1);
  });

  it('el fallo de UNA red no tumba el resto', async () => {
    const driver = fakeDriver({
      listWifiNetworks: vi.fn(async () => [{ id: 'roto' }, { id: 'ok' }] as never),
      listNetworkClients: vi.fn(async (id: string) => {
        if (id === 'roto') throw new Error('timeout');
        return [{ mac: 'bb:bb:bb:bb:bb:bb', hostname: null, ip: '10.0.0.3', signalDbm: -60 }] as never;
      }),
    });
    const out = await collectSignalByMac(driver);
    expect(out.get('bb:bb:bb:bb:bb:bb')).toBe(-60);
  });
});
