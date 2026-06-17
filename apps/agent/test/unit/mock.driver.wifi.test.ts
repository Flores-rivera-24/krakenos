import { describe, expect, it } from 'vitest';
import { MockDriver } from '../../src/drivers/mock.driver.js';

describe('MockDriver — WiFi multi-AP', () => {
  it('lista access points y redes', async () => {
    const d = new MockDriver();
    expect((await d.listAccessPoints()).length).toBeGreaterThan(0);
    expect((await d.listWifiNetworks()).length).toBeGreaterThan(0);
  });

  it('obtiene una red por id (y null si no existe)', async () => {
    const d = new MockDriver();
    const net = await d.getWifiNetwork('net-salon-5');
    expect(net?.ssid).toBe('KrakenOS');
    expect(await d.getWifiNetwork('nope')).toBeNull();
  });

  it('actualiza una red existente y devuelve null para una inexistente', async () => {
    const d = new MockDriver();
    const updated = await d.updateWifiNetwork('net-salon-guest', { enabled: true });
    expect(updated?.enabled).toBe(true);
    expect(await d.updateWifiNetwork('nope', { enabled: true })).toBeNull();
  });

  it('no incluye la contraseña en la red actualizada', async () => {
    const d = new MockDriver();
    const updated = await d.updateWifiNetwork('net-salon-5', { password: 'secreto12' });
    expect(updated as object).not.toHaveProperty('password');
  });

  it('lista clientes de una red (null si la red no existe)', async () => {
    const d = new MockDriver();
    const clients = await d.listNetworkClients('net-salon-5');
    expect(Array.isArray(clients)).toBe(true);
    expect(clients!.length).toBeGreaterThan(0);
    expect(await d.listNetworkClients('nope')).toBeNull();
  });
});
