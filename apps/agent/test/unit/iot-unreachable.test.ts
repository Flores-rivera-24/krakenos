import { describe, expect, it } from 'vitest';
import { ShellyIotManager } from '../../src/iot/shelly.iot.js';
import { KasaIotManager } from '../../src/iot/kasa.iot.js';
import { unreachableDevice } from '../../src/iot/unreachable.js';

/**
 * US-242: un aparato configurado que no responde **sigue en la lista** con
 * `reachable:false`. Antes desaparecía, y desde la pantalla «apagado» y
 * «desenchufado / sin WiFi» se veían exactamente igual: un hueco.
 */

describe('unreachableDevice (US-242)', () => {
  it('no inventa estado: todo a null salvo la identidad', () => {
    const d = unreachableDevice({ id: 'shelly:10.0.0.5:0', name: 'Lámpara', kind: 'plug' });
    expect(d).toMatchObject({
      id: 'shelly:10.0.0.5:0',
      name: 'Lámpara',
      reachable: false,
      on: null,
      brightness: null,
      color: null,
      readings: [],
    });
    // El último valor conocido sería una mentira con pinta de dato fresco.
    expect(d.powerW).toBeNull();
  });
});

describe('ShellyIotManager sin respuesta (US-242)', () => {
  const caido = { get: () => Promise.reject(new Error('EHOSTUNREACH')) };

  it('el aparato configurado sigue listado, marcado como no disponible', async () => {
    const mgr = new ShellyIotManager({
      transport: caido as never,
      devices: [{ ip: '10.0.0.5', name: 'Lámpara', gen: 2, channels: 1 }],
    });
    const devices = await mgr.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]?.reachable).toBe(false);
    expect(devices[0]?.id).toBe('shelly:10.0.0.5:0');
    expect(devices[0]?.name).toBe('Lámpara');
  });

  it('un aparato de varios canales conserva sus canales', async () => {
    const mgr = new ShellyIotManager({
      transport: caido as never,
      devices: [{ ip: '10.0.0.6', name: 'Regleta', gen: 2, channels: 2 }],
    });
    const devices = await mgr.listDevices();
    expect(devices.map((d) => d.id)).toEqual(['shelly:10.0.0.6:0', 'shelly:10.0.0.6:1']);
    expect(devices.every((d) => !d.reachable)).toBe(true);
  });
});

describe('KasaIotManager sin respuesta (US-242)', () => {
  it('una IP declarada a mano se lista como no disponible', async () => {
    const mgr = new KasaIotManager({
      kasa: {
        discover: () => Promise.resolve([]),
        send: () => Promise.reject(new Error('EHOSTUNREACH')),
      } as never,
      kasaIps: ['10.0.0.9'],
    });
    const devices = await mgr.listDevices();
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ id: 'kasa:10.0.0.9', reachable: false });
  });

  it('lo que solo salió del descubrimiento y hoy no contesta NO se inventa', async () => {
    // De ese aparato no consta que exista: listarlo sería prometer un aparato que
    // a lo mejor nunca estuvo ahí.
    const mgr = new KasaIotManager({
      kasa: {
        discover: () => Promise.reject(new Error('sin red')),
        send: () => Promise.reject(new Error('EHOSTUNREACH')),
      } as never,
    });
    expect(await mgr.listDevices()).toEqual([]);
  });
});
