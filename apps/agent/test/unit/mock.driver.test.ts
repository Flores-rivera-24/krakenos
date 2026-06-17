import { beforeEach, describe, expect, it } from 'vitest';
import { MockDriver } from '../../src/drivers/mock.driver.js';

describe('MockDriver', () => {
  let driver: MockDriver;

  beforeEach(() => {
    driver = new MockDriver();
  });

  it('reporta su tipo y pasa el healthcheck', async () => {
    expect(driver.kind).toBe('mock');
    expect(await driver.healthcheck()).toBe(true);
  });

  it('scanArp devuelve dispositivos con origen "arp"', async () => {
    const devices = await driver.scanArp();
    expect(devices.length).toBeGreaterThan(0);
    expect(devices.every((d) => d.source === 'arp')).toBe(true);
    expect(devices.every((d) => /^[0-9a-f:]+$/.test(d.mac))).toBe(true);
  });

  it('scanMdns aporta hostnames y origen "mdns"', async () => {
    const devices = await driver.scanMdns();
    expect(devices.every((d) => d.source === 'mdns')).toBe(true);
    expect(devices.some((d) => d.hostname)).toBe(true);
  });

  it('block/unblock es idempotente y no lanza', async () => {
    await expect(driver.blockDevice('AA:BB:CC:DD:EE:FF')).resolves.toBeUndefined();
    await expect(driver.blockDevice('AA:BB:CC:DD:EE:FF')).resolves.toBeUndefined();
    await expect(driver.unblockDevice('AA:BB:CC:DD:EE:FF')).resolves.toBeUndefined();
    await expect(driver.unblockDevice('no-estaba')).resolves.toBeUndefined();
  });

  it('getWifi devuelve la red principal', async () => {
    const wifi = await driver.getWifi();
    expect(wifi.ssid).toBe('KrakenOS');
    expect(wifi.enabled).toBe(true);
  });

  it('updateWifi aplica cambios pero nunca persiste la contraseña en el objeto devuelto', async () => {
    const before = await driver.getWifi();
    const updated = await driver.updateWifi({ ssid: 'NuevaRed', password: 'supersecreta' });
    expect(updated.ssid).toBe('NuevaRed');
    expect(updated).not.toHaveProperty('password');
    expect(Date.parse(updated.updatedAt)).toBeGreaterThanOrEqual(Date.parse(before.updatedAt));
  });

  it('updateGuestNetwork aplica cambios sin filtrar la contraseña', async () => {
    const updated = await driver.updateGuestNetwork({ enabled: true, password: 'invitados' });
    expect(updated.enabled).toBe(true);
    expect(updated).not.toHaveProperty('password');
  });
});
