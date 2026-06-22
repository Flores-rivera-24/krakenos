import { describe, expect, it } from 'vitest';
import {
  bandPrefix,
  buildMacFilter,
  parseClientList,
  parseNvram,
  parseTraffics,
  securityFromAuthMode,
} from '../../src/drivers/asus.parsers.js';

describe('asus.parsers', () => {
  it('parseClientList mapea get_clientlist a Device y solo devuelve online', () => {
    const text = JSON.stringify({
      get_clientlist: {
        maclist: ['AA:BB:CC:DD:EE:FF', '11:22:33:44:55:66'],
        'AA:BB:CC:DD:EE:FF': { ip: '192.168.1.10', name: 'pc', nickName: 'Mi PC', vendor: 'Asus', isOnline: '1' },
        '11:22:33:44:55:66': { ip: '192.168.1.20', name: 'old', isOnline: '0' },
      },
    });
    expect(parseClientList(text)).toEqual([
      { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.10', hostname: 'Mi PC', vendor: 'Asus', source: 'arp' },
    ]);
  });

  it('parseTraffics extrae los contadores WAN (hex y decimal)', () => {
    const netdev = JSON.stringify({ netdev: { INTERNET: { rx: '0x100', tx: '256' } } });
    expect(parseTraffics(netdev)).toEqual({ rxBytes: 256, txBytes: 256 });
    expect(parseTraffics('no-json')).toBeNull();
  });

  it('parseNvram acepta JSON y formato clave=valor / clave: "valor"', () => {
    expect(parseNvram('{"wl0_ssid":"Casa","wl0_wpa_psk":"secret"}')).toEqual({
      wl0_ssid: 'Casa',
      wl0_wpa_psk: 'secret',
    });
    expect(parseNvram('wl0_ssid=Casa\nwl0_closed=1')).toEqual({ wl0_ssid: 'Casa', wl0_closed: '1' });
    expect(parseNvram('wl1_ssid: "Casa-5G",')).toEqual({ wl1_ssid: 'Casa-5G' });
  });

  it('securityFromAuthMode y bandPrefix mapean la nomenclatura ASUS', () => {
    expect(securityFromAuthMode('open')).toBe('open');
    expect(securityFromAuthMode('psk2')).toBe('wpa2');
    expect(securityFromAuthMode('sae')).toBe('wpa3');
    expect(securityFromAuthMode('psk2sae')).toBe('wpa2/wpa3');
    expect(bandPrefix('2.4GHz')).toBe('wl0');
    expect(bandPrefix('5GHz')).toBe('wl1');
  });

  it('buildMacFilter añade/quita la MAC en la lista MULTIFILTER_MAC (sep >)', () => {
    expect(buildMacFilter('', 'AA:BB:CC:DD:EE:FF', 'add')).toBe('aa:bb:cc:dd:ee:ff');
    expect(buildMacFilter('11:22:33:44:55:66', 'AA:BB:CC:DD:EE:FF', 'add')).toBe(
      '11:22:33:44:55:66>aa:bb:cc:dd:ee:ff',
    );
    // idempotente al añadir un duplicado
    expect(buildMacFilter('aa:bb:cc:dd:ee:ff', 'AA:BB:CC:DD:EE:FF', 'add')).toBe('aa:bb:cc:dd:ee:ff');
    expect(buildMacFilter('11:22:33:44:55:66>aa:bb:cc:dd:ee:ff', 'aa:bb:cc:dd:ee:ff', 'remove')).toBe(
      '11:22:33:44:55:66',
    );
  });
});
