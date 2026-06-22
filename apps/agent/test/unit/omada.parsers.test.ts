import { describe, expect, it } from 'vitest';
import {
  bandFromOmada,
  buildWlanPatch,
  parseOmadaAccessPoints,
  parseOmadaClients,
  parseOmadaTraffic,
  parseOmadaWlans,
  parseSites,
  pickData,
  securityFromOmada,
} from '../../src/drivers/omada.parsers.js';

describe('omada.parsers', () => {
  it('pickData acepta array directo y {data}', () => {
    expect(pickData([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(pickData({ data: [{ b: 2 }], totalRows: 1 })).toEqual([{ b: 2 }]);
    expect(pickData(null)).toEqual([]);
  });

  it('parseOmadaClients normaliza la MAC (guiones→:), mapea y deduplica', () => {
    const result = {
      data: [
        { mac: 'AA-BB-CC-DD-EE-FF', ip: '192.168.1.42', name: 'macbook', vendor: 'Apple' },
        { mac: '11-22-33-44-55-66', ipAddr: '192.168.1.50', hostName: 'pi' },
        { mac: 'AA-BB-CC-DD-EE-FF', ip: '192.168.1.99' }, // dup → fuera
        { ip: '192.168.1.5' }, // sin MAC → fuera
      ],
    };
    expect(parseOmadaClients(result, 'arp')).toEqual([
      { mac: 'aa:bb:cc:dd:ee:ff', ip: '192.168.1.42', hostname: 'macbook', vendor: 'Apple', source: 'arp' },
      { mac: '11:22:33:44:55:66', ip: '192.168.1.50', hostname: 'pi', vendor: null, source: 'arp' },
    ]);
  });

  it('parseOmadaAccessPoints mapea estado (status!=0 → online) y nº de clientes', () => {
    const result = {
      data: [
        { mac: 'AA-BB-CC-DD-EE-01', name: 'EAP-Salón', model: 'EAP670', ip: '192.168.1.20', status: 11, clientNum: 4 },
        { mac: 'AA-BB-CC-DD-EE-02', model: 'EAP225', status: 0 },
      ],
    };
    expect(parseOmadaAccessPoints(result)).toEqual([
      { id: 'aa:bb:cc:dd:ee:01', name: 'EAP-Salón', model: 'EAP670', ip: '192.168.1.20', online: true, networkCount: 4 },
      { id: 'aa:bb:cc:dd:ee:02', name: 'EAP225', model: 'EAP225', ip: '', online: false, networkCount: 0 },
    ]);
  });

  it('bandFromOmada y securityFromOmada mapean la nomenclatura Omada', () => {
    expect(bandFromOmada(0)).toBe('2.4GHz');
    expect(bandFromOmada(1)).toBe('5GHz');
    expect(bandFromOmada(2)).toBe('6GHz');
    expect(securityFromOmada({ security: 0 })).toBe('open');
    expect(securityFromOmada({ security: 3, wpaMode: 3 })).toBe('wpa3');
    expect(securityFromOmada({ security: 3 })).toBe('wpa2');
  });

  it('parseOmadaWlans mapea WLANs a WifiNetworkInfo', () => {
    const result = {
      data: [
        { id: 'w1', name: 'Casa', wlanBand: 1, security: 3, enable: true, broadcast: true },
        { id: 'w2', name: 'Invitados', wlanBand: 0, security: 0, guestNetEnable: true, broadcast: false },
      ],
    };
    expect(parseOmadaWlans(result, 'omada')).toEqual([
      { id: 'w1', apId: 'omada', ssid: 'Casa', band: '5GHz', security: 'wpa2', enabled: true, hidden: false, isGuest: false, clientCount: 0 },
      { id: 'w2', apId: 'omada', ssid: 'Invitados', band: '2.4GHz', security: 'open', enabled: true, hidden: true, isGuest: true, clientCount: 0 },
    ]);
  });

  it('parseOmadaTraffic lee wanDownload/wanUpload y parseSites resuelve el siteId', () => {
    expect(parseOmadaTraffic({ wanDownload: 1_500_000.7, wanUpload: 250_000 })).toEqual({
      rxBytesPerSec: 1_500_001,
      txBytesPerSec: 250_000,
    });
    const current = parseSites({ privilege: { sites: [{ name: 'Default', key: 'site-123' }, { name: 'Otra', key: 'site-9' }] } });
    expect(current).toEqual([
      { name: 'Default', id: 'site-123' },
      { name: 'Otra', id: 'site-9' },
    ]);
  });

  it('buildWlanPatch parte de la WLAN actual y aplica cambios (psk + broadcast)', () => {
    const current = { id: 'w1', name: 'Casa', enable: true, psk: 'old', security: 3 };
    const body = buildWlanPatch(current, { ssid: 'Nueva', password: 'secret123', hidden: true, band: '6GHz' });
    expect(body).toMatchObject({
      id: 'w1',
      name: 'Nueva',
      psk: 'secret123',
      broadcast: false, // hidden=true → broadcast=false
      wlanBand: 2,
      security: 3, // preservado
    });
  });
});
