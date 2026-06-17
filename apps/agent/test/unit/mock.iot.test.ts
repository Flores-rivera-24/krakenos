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

  it('rechaza controlar un sensor', async () => {
    const iot = new MockIotManager();
    await expect(iot.setState('sensor-temp', { on: true })).rejects.toBeInstanceOf(IotError);
  });

  it('lanza si el dispositivo no existe', async () => {
    const iot = new MockIotManager();
    await expect(iot.setState('nope', { on: true })).rejects.toMatchObject({ code: 'IOT_NOT_FOUND' });
  });
});
