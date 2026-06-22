import { describe, expect, it } from 'vitest';
import {
  bandFromRadio,
  buildWlanUpdate,
  parseUnifiAccessPoints,
  parseUnifiClients,
  parseUnifiHealth,
  parseUnifiWlans,
  pickArray,
  securityFromWlan,
} from '../../src/drivers/unifi.parsers.js';

describe('unifi.parsers', () => {
  it('pickArray acepta array directo y sobre {data}', () => {
    expect(pickArray([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(pickArray({ data: [{ b: 2 }] })).toEqual([{ b: 2 }]);
    expect(pickArray({ meta: {} })).toEqual([]);
    expect(pickArray(null)).toEqual([]);
  });

  it('parseUnifiClients mapea mac/ip/hostname/vendor y deduplica', () => {
    const data = {
      data: [
        { mac: 'F0:18:98:AA:BB:CC', ip: '192.168.1.42', hostname: 'macbook', oui: 'Apple' },
        { mac: 'dc:a6:32:de:ad:02', last_ip: '192.168.1.50', name: 'pi' },
        { mac: 'F0:18:98:AA:BB:CC', ip: '192.168.1.99' }, // duplicado por MAC → se ignora
        { ip: '192.168.1.5' }, // sin MAC → se ignora
      ],
    };
    expect(parseUnifiClients(data, 'arp')).toEqual([
      { mac: 'f0:18:98:aa:bb:cc', ip: '192.168.1.42', hostname: 'macbook', vendor: 'Apple', source: 'arp' },
      { mac: 'dc:a6:32:de:ad:02', ip: '192.168.1.50', hostname: 'pi', vendor: null, source: 'arp' },
    ]);
  });

  it('bandFromRadio y securityFromWlan mapean la nomenclatura UniFi', () => {
    expect(bandFromRadio('ng')).toBe('2.4GHz');
    expect(bandFromRadio('na')).toBe('5GHz');
    expect(bandFromRadio('6e')).toBe('6GHz');
    expect(securityFromWlan({ security: 'open' })).toBe('open');
    expect(securityFromWlan({ wpa3_support: true, wpa3_transition: true })).toBe('wpa2/wpa3');
    expect(securityFromWlan({ wpa3_support: true })).toBe('wpa3');
    expect(securityFromWlan({ security: 'wpapsk' })).toBe('wpa2');
  });

  it('parseUnifiWlans mapea WLANs a WifiNetworkInfo', () => {
    const data = [
      { _id: 'w1', name: 'Casa', wlan_band: 'na', enabled: true, hide_ssid: false, is_guest: false },
      { _id: 'w2', name: 'Invitados', wlan_band: 'ng', is_guest: true, hide_ssid: true, security: 'open' },
      { name: 'sin-id' }, // sin id → se ignora
    ];
    const wlans = parseUnifiWlans(data, 'unifi');
    expect(wlans).toEqual([
      { id: 'w1', apId: 'unifi', ssid: 'Casa', band: '5GHz', security: 'wpa2', enabled: true, hidden: false, isGuest: false, clientCount: 0 },
      { id: 'w2', apId: 'unifi', ssid: 'Invitados', band: '2.4GHz', security: 'open', enabled: true, hidden: true, isGuest: true, clientCount: 0 },
    ]);
  });

  it('parseUnifiAccessPoints filtra type=uap y mapea estado', () => {
    const data = [
      { _id: 'ap1', type: 'uap', name: 'Salón', model: 'U6-Lite', ip: '192.168.1.20', state: 1, vap_table: [{}, {}] },
      { _id: 'sw1', type: 'usw', name: 'Switch' }, // no es AP → se filtra
      { _id: 'ap2', type: 'uap', model: 'U6-Pro', state: 0 },
    ];
    expect(parseUnifiAccessPoints(data)).toEqual([
      { id: 'ap1', name: 'Salón', model: 'U6-Lite', ip: '192.168.1.20', online: true, networkCount: 2 },
      { id: 'ap2', name: 'U6-Pro', model: 'U6-Pro', ip: '', online: false, networkCount: 0 },
    ]);
  });

  it('parseUnifiHealth lee las tasas WAN del subsistema wan', () => {
    const data = {
      data: [
        { subsystem: 'wlan', num_user: 5 },
        { subsystem: 'wan', wan_rx_bytes_r: 1_500_000.4, wan_tx_bytes_r: 250_000.6 },
      ],
    };
    expect(parseUnifiHealth(data)).toEqual({ rxBytesPerSec: 1_500_000, txBytesPerSec: 250_001 });
    expect(parseUnifiHealth([{ subsystem: 'lan' }])).toEqual({ rxBytesPerSec: 0, txBytesPerSec: 0 });
  });

  it('buildWlanUpdate parte de la WLAN actual y aplica cambios (passphrase incluida)', () => {
    const current = { _id: 'w1', name: 'Casa', enabled: true, x_passphrase: 'old', wlan_band: 'ng', security: 'wpapsk' };
    const body = buildWlanUpdate(current, { ssid: 'NuevaCasa', password: 'secret123', enabled: false, band: '5GHz' });
    expect(body).toMatchObject({
      _id: 'w1',
      name: 'NuevaCasa',
      x_passphrase: 'secret123',
      enabled: false,
      wlan_band: 'na',
      security: 'wpapsk', // campo preservado
    });
  });
});
