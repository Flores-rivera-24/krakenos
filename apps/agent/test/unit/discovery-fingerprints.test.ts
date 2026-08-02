import { describe, expect, it } from 'vitest';
import {
  isPrivateIpv4,
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

  it('⚠️ Shelly se precarga como LISTA JSON, no como una IP suelta (US-249)', () => {
    // El campo `devices` del backend se parsea con `JSON.parse`: con la IP a secas
    // el usuario seguía la sugerencia, guardaba y se quedaba con cero aparatos.
    const gen2 = matchFingerprints([
      mdns({
        service: '_shelly._tcp.local',
        name: 'ShellyPlus1-A8032AB._shelly._tcp.local',
        ip: '192.168.1.60',
        txt: { gen: '2' },
      }),
    ]);
    expect(JSON.parse(gen2[0]?.prefill.devices ?? '')).toEqual([
      { ip: '192.168.1.60', name: 'ShellyPlus1-A8032AB', gen: 2 },
    ]);
    expect(gen2[0]?.label).toContain('ShellyPlus1');

    // La generación la dice el propio anuncio; sin `gen` en el TXT se asume la 1,
    // que es el defecto del parser del backend (no se inventa).
    const gen1 = matchFingerprints([
      mdns({ name: 'shelly1-B4E842._http._tcp.local', ip: '192.168.1.61' }),
    ]);
    expect(gen1[0]?.kind).toBe('shelly');
    expect(JSON.parse(gen1[0]?.prefill.devices ?? '')[0]).toMatchObject({ gen: 1 });
  });

  it('un broker MQTT ofrece las DOS vías que lo aprovechan (US-249)', () => {
    // El broker no dice para qué se usa: adivinar una sola dejaba fuera la ingesta
    // genérica de US-248, que es la que sirve con cualquier cacharro liberado.
    const out = matchFingerprints([
      mdns({ service: '_mqtt._tcp.local', name: 'mosquitto._mqtt._tcp.local', ip: '192.168.1.10', port: 1883 }),
    ]);
    expect(out.map((m) => m.kind).sort()).toEqual(['mqtt', 'zigbee']);
    for (const match of out) {
      expect(match.prefill).toEqual({ brokerUrl: 'mqtt://192.168.1.10:1883' });
    }
  });

  it('un ESPHome sugiere la ingesta genérica, y sin prefill a propósito (US-249)', () => {
    const out = matchFingerprints([
      mdns({ service: '_esphomelib._tcp.local', name: 'salon-rele._esphomelib._tcp.local', ip: '192.168.1.90' }),
    ]);
    expect(out[0]).toMatchObject({ kind: 'mqtt', prefill: {} });
    // El aparato no dice cuál es su broker, así que esta sugerencia NO puede ser
    // de un toque: abre el asistente, que explica qué hace falta.
    expect(out[0]?.label).toContain('ESPHome');
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

  it('descarta IPs fuera de la LAN: la IP anunciada la controla el emisor del datagrama', () => {
    const out = matchFingerprints([
      // Registro A hostil apuntando a una IP pública y a metadata de nube.
      mdns({ service: '_hue._tcp.local', name: 'Evil._hue._tcp.local', ip: '203.0.113.7' }),
      mdns({ service: '_hue._tcp.local', name: 'Evil._hue._tcp.local', ip: '169.254.169.254' }),
      { type: 'ssdp', ip: '8.8.8.8', headers: { 'hue-bridgeid': 'X' } },
    ]);
    expect(out).toHaveLength(0);

    expect(isPrivateIpv4('10.0.0.5')).toBe(true);
    expect(isPrivateIpv4('172.31.1.1')).toBe(true);
    expect(isPrivateIpv4('192.168.1.2')).toBe(true);
    expect(isPrivateIpv4('172.32.0.1')).toBe(false);
    expect(isPrivateIpv4('no-una-ip')).toBe(false);
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
