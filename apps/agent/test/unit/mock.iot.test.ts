import { describe, expect, it } from 'vitest';
import { IotError, MockIotManager } from '../../src/iot/mock.iot.js';

describe('MockIotManager', () => {
  it('lista dispositivos sembrados (luces, enchufes, sensores)', async () => {
    const devices = await new MockIotManager().listDevices();
    expect(devices.length).toBeGreaterThan(0);
    expect(devices.some((d) => d.kind === 'light')).toBe(true);
    expect(devices.some((d) => d.kind === 'plug')).toBe(true);
    expect(devices.some((d) => d.kind === 'sensor')).toBe(true);
  });

  it('enciende/apaga un enchufe', async () => {
    const iot = new MockIotManager();
    const updated = await iot.setState('plug-cafetera', { on: true });
    expect(updated.on).toBe(true);
  });

  it('ajusta el brillo de una luz y la enciende si era 0', async () => {
    const iot = new MockIotManager();
    await iot.setState('light-dormitorio', { on: false });
    const updated = await iot.setState('light-dormitorio', { brightness: 60 });
    expect(updated.brightness).toBe(60);
    expect(updated.on).toBe(true);
  });

  it('simula potencia (powerW) según el estado del dispositivo (US-181)', async () => {
    const iot = new MockIotManager();
    const devices = await iot.listDevices();
    const byId = new Map(devices.map((d) => [d.id, d]));

    // Enchufe encendido con carga → potencia > 0; apagado → 0.
    expect(byId.get('plug-tv')?.powerW).toBeGreaterThan(0); // nace encendido
    expect(byId.get('plug-cafetera')?.powerW).toBe(0); // nace apagado
    // Los sensores no miden potencia.
    expect(byId.get('sensor-clima')?.powerW).toBeNull();
  });

  it('encender un enchufe le da potencia; apagarlo la lleva a 0 (US-181)', async () => {
    const iot = new MockIotManager();
    const on = await iot.setState('plug-cafetera', { on: true });
    expect(on.powerW).toBeGreaterThan(0);
    const off = await iot.setState('plug-cafetera', { on: false });
    expect(off.powerW).toBe(0);
  });

  it('la potencia de una luz escala con el brillo (US-181)', async () => {
    const iot = new MockIotManager();
    const full = await iot.setState('light-salon', { on: true, brightness: 100 });
    const half = await iot.setState('light-salon', { brightness: 50 });
    expect(half.powerW).toBeCloseTo((full.powerW ?? 0) / 2, 1);
  });

  it('rechaza controlar un sensor', async () => {
    const iot = new MockIotManager();
    await expect(iot.setState('sensor-temp', { on: true })).rejects.toBeInstanceOf(IotError);
  });

  it('lanza si el dispositivo no existe', async () => {
    const iot = new MockIotManager();
    await expect(iot.setState('nope', { on: true })).rejects.toMatchObject({ code: 'IOT_NOT_FOUND' });
  });
});
