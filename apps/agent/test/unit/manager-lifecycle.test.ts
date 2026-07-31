import type { HardwareDriver, Vlan } from '@krakenos/types';
import { describe, expect, it, vi } from 'vitest';
import { wrapDriverErrors } from '../../src/drivers/driver-error.js';
import { MikrotikDriver } from '../../src/drivers/mikrotik.driver.js';
import { OpenWrtDriver } from '../../src/drivers/openwrt.driver.js';
import { disposeManager, stopManager } from '../../src/integrations/manager-holder.js';
import { MemoryJsonStore } from '../../src/store/json-store.js';
import { SwitchVlanManager } from '../../src/vlan/switch.vlan.js';

/**
 * US-229 / AUD3-16 — la fuga de sesiones SSH.
 *
 * `disposeManager` buscaba `stop`/`close`/`dispose` **en el manager**, pero los 6
 * managers de red no exponían ninguno: su `dispose()` vivía en el transporte y
 * nadie lo llamaba. Resultado: cada «Probar conexión» del asistente y cada
 * recarga de integración dejaba una sesión SSH/SNMP abierta contra el equipo del
 * usuario, indefinidamente.
 *
 * Estos tests atan las dos mitades de la cadena: que cada manager cierre su
 * transporte, y que la limpieza genérica encuentre ese `stop()` — incluso a
 * través del Proxy `wrapDriverErrors`, que es lo que el runtime guarda de verdad.
 */

/** Transporte falso que cuenta sus cierres (vale para SSH, NETCONF y SNMP). */
function countingTransport(): { dispose: () => Promise<void>; disposed: () => number } {
  let disposed = 0;
  return {
    dispose: async () => {
      disposed += 1;
    },
    disposed: () => disposed,
  };
}

describe('stop() de los managers de red (US-229)', () => {
  it('OpenWrtDriver.stop() cierra la sesión SSH del transporte', async () => {
    const t = countingTransport();
    const driver = new OpenWrtDriver({
      transport: { exec: vi.fn(), dispose: t.dispose },
      wanInterface: 'wan',
    });

    await driver.stop();

    expect(t.disposed()).toBe(1);
  });

  it('MikrotikDriver.stop() cierra la sesión del transporte', async () => {
    const t = countingTransport();
    const driver = new MikrotikDriver({
      transport: { list: vi.fn(), set: vi.fn(), add: vi.fn(), remove: vi.fn(), dispose: t.dispose },
    });

    await driver.stop();

    expect(t.disposed()).toBe(1);
  });

  it('SwitchVlanManager.stop() cierra la sesión SNMP', async () => {
    const t = countingTransport();
    const vlans = new SwitchVlanManager({
      store: new MemoryJsonStore<Vlan>(),
      snmp: { get: vi.fn(), set: vi.fn(), walk: vi.fn(), dispose: t.dispose },
    });

    await vlans.stop();

    expect(t.disposed()).toBe(1);
  });

  it('un transporte sin `dispose` (REST) no rompe el cierre', async () => {
    const driver = new MikrotikDriver({
      transport: { list: vi.fn(), set: vi.fn(), add: vi.fn(), remove: vi.fn() },
    });

    await expect(driver.stop()).resolves.toBeUndefined();
  });
});

describe('stopManager / disposeManager (US-229)', () => {
  it('encuentra y ESPERA el `stop()` del manager', async () => {
    let done = false;
    const manager = {
      stop: async () => {
        await Promise.resolve();
        done = true;
      },
    };

    await stopManager(manager);

    expect(done).toBe(true);
  });

  it('encuentra el `stop()` A TRAVÉS del Proxy de wrapDriverErrors (lo que guarda el runtime)', async () => {
    const t = countingTransport();
    const driver = wrapDriverErrors(
      new OpenWrtDriver({
        transport: { exec: vi.fn(), dispose: t.dispose },
        wanInterface: 'wan',
      }) as unknown as HardwareDriver,
    );

    await stopManager(driver);

    expect(t.disposed()).toBe(1);
  });

  it('un manager sin limpieza no es un error (mock, backends REST)', async () => {
    await expect(stopManager({ listDevices: vi.fn() })).resolves.toBeUndefined();
    expect(() => disposeManager({})).not.toThrow();
  });

  it('un cierre que falla se traga (best-effort): no rompe el swap ni el apagado', async () => {
    const manager = { stop: () => Promise.reject(new Error('socket ya roto')) };

    await expect(stopManager(manager)).resolves.toBeUndefined();
    expect(() => disposeManager(manager)).not.toThrow();
  });
});
