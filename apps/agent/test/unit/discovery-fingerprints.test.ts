import { describe, expect, it } from 'vitest';
import {
  matchFingerprints,
  type DiscoveryProbeRecord,
} from '../../src/discovery/fingerprints.js';

const mdns = (
  over: Partial<Extract<DiscoveryProbeRecord, { type: 'mdns' }>> = {},
): DiscoveryProbeRecord => ({
  type: 'mdns',
  service: '_http._tcp.local',
  name: 'aparato._http._tcp.local',
  ip: '192.168.1.50',
  port: 80,
  txt: {},
  ...over,
});

/** Huellas del auto-descubrimiento (US-175): puras, con fixtures realistas. */
describe('discovery/fingerprints', () => {
  it('reconoce un bridge Hue por mDNS y precarga su URL', () => {
    const out = matchFingerprints([
      mdns({ service: '_hue._tcp.local', name: 'Philips Hue - ABC123._hue._tcp.local', ip: '192.168.1.2' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      domain: 'iot',
      kind: 'hue',
      prefill: { bridgeUrl: 'http://192.168.1.2' },
      source: 'mdns',
    });
  });

  it('reconoce un bridge Hue por SSDP (hue-bridgeid / IpBridge)', () => {
    const byId = matchFingerprints([
      { type: 'ssdp', ip: '192.168.1.2', headers: { 'hue-bridgeid': 'ECB5FAFFFE000000' } },
    ]);
    expect(byId[0]).toMatchObject({ kind: 'hue', source: 'ssdp' });

    const byServer = matchFingerprints([
      {
        type: 'ssdp',
        ip: '192.168.1.2',
        headers: { server: 'Hue/1.0 UPnP/1.0 IpBridge/1.60.0', st: 'upnp:rootdevice' },
      },
    ]);
    expect(byServer[0]?.kind).toBe('hue');
  });

  it('reconoce Shelly por servicio propio o por nombre, con la IP en devices', () => {
    const gen2 = matchFingerprints([
      mdns({ service: '_shelly._tcp.local', name: 'ShellyPlus1-A8032AB._shelly._tcp.local', ip: '192.168.1.60' }),
    ]);
    expect(gen2[0]).toMatchObject({ kind: 'shelly', prefill: { devices: '192.168.1.60' } });
    expect(gen2[0]?.label).toContain('ShellyPlus1');

    const gen1 = matchFingerprints([
      mdns({ name: 'shelly1-B4E842._http._tcp.local', ip: '192.168.1.61' }),
    ]);
    expect(gen1[0]?.kind).toBe('shelly');
  });

  it('un broker MQTT sugiere zigbee2mqtt con la URL precargada', () => {
    const out = matchFingerprints([
      mdns({ service: '_mqtt._tcp.local', name: 'mosquitto._mqtt._tcp.local', ip: '192.168.1.10', port: 1883 }),
    ]);
    expect(out[0]).toMatchObject({
      kind: 'zigbee',
      prefill: { brokerUrl: 'mqtt://192.168.1.10:1883' },
    });
  });

  it('distingue Kasa y Tapo por nombre y precarga el campo de IPs correcto', () => {
    const tapo = matchFingerprints([mdns({ name: 'Tapo P110._http._tcp.local', ip: '192.168.1.71' })]);
    expect(tapo[0]).toMatchObject({ kind: 'kasa', prefill: { tapoDeviceIps: '192.168.1.71' } });

    const kasa = matchFingerprints([mdns({ name: 'HS110(EU)._http._tcp.local', ip: '192.168.1.72' })]);
    expect(kasa[0]).toMatchObject({ kind: 'kasa', prefill: { kasaDeviceIps: '192.168.1.72' } });
  });

  it('reconoce cámaras ONVIF por mDNS y SSDP (dominio cameras, sin prefill de credenciales)', () => {
    const byMdns = matchFingerprints([
      mdns({ service: '_onvif._tcp.local', name: 'IPCam._onvif._tcp.local', ip: '192.168.1.80' }),
    ]);
    expect(byMdns[0]).toMatchObject({ domain: 'cameras', kind: 'rtsp', prefill: {} });

    const bySsdp = matchFingerprints([
      {
        type: 'ssdp',
        ip: '192.168.1.81',
        headers: { st: 'urn:schemas-onvif-org:device:NetworkVideoTransmitter:1' },
      },
    ]);
    expect(bySsdp[0]).toMatchObject({ domain: 'cameras', kind: 'rtsp' });
  });

  it('lo desconocido no genera sugerencias (propone, no inventa)', () => {
    const out = matchFingerprints([
      mdns({ service: '_googlecast._tcp.local', name: 'Chromecast._googlecast._tcp.local' }),
      { type: 'ssdp', ip: '192.168.1.90', headers: { server: 'Samsung TV UPnP/1.0' } },
    ]);
    expect(out).toHaveLength(0);
  });

  it('deduplica por kind:ip prefiriendo la entrada con hostname (mDNS sobre SSDP)', () => {
    const out = matchFingerprints([
      { type: 'ssdp', ip: '192.168.1.2', headers: { 'hue-bridgeid': 'X' } },
      mdns({ service: '_hue._tcp.local', name: 'Hue Bridge._hue._tcp.local', ip: '192.168.1.2' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.hostname).toBe('Hue Bridge');
  });
});
