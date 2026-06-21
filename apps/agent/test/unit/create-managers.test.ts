import { describe, expect, it } from 'vitest';
import { MockCameraManager, RtspCameraManager, createCameraManager } from '../../src/cameras/index.js';
import { MockDnsManager, PiholeDnsManager, createDnsManager } from '../../src/dns/index.js';
import {
  IptablesFirewallManager,
  MockFirewallManager,
  createFirewallManager,
} from '../../src/firewall/index.js';
import { CompositeIotManager, GoveeIotManager, HueIotManager, MatterIotManager, MockIotManager, ZigbeeIotManager, createIotManager } from '../../src/iot/index.js';
import { MockQosManager, TcQosManager, createQosManager } from '../../src/qos/index.js';
import { MockVlanManager, SwitchVlanManager, createVlanManager } from '../../src/vlan/index.js';
import { MockVpnManager, WireguardVpnManager, createVpnManager } from '../../src/vpn/index.js';

const VPN_CONFIG = { endpoint: 'vpn.test', listenPort: 51820 } as const;

describe('createVpnManager', () => {
  it('devuelve un MockVpnManager para kind "mock"', () => {
    const vpn = createVpnManager({ kind: 'mock', ...VPN_CONFIG });
    expect(vpn).toBeInstanceOf(MockVpnManager);
  });

  it('lanza si falta la configuración WireGuard', () => {
    expect(() => createVpnManager({ kind: 'wireguard', ...VPN_CONFIG })).toThrow(/WireGuard/i);
  });

  it('devuelve un WireguardVpnManager con su configuración', () => {
    const vpn = createVpnManager({
      kind: 'wireguard',
      ...VPN_CONFIG,
      wireguard: {
        interface: 'wg0',
        subnet: '10.8.0.0/24',
        dns: '10.8.0.1',
        helperPath: '/usr/local/bin/krakenos-helper',
        peerStorePath: '/tmp/krakenos-peers.json',
      },
    });
    expect(vpn).toBeInstanceOf(WireguardVpnManager);
  });

  it('lanza para un kind desconocido', () => {
    expect(() => createVpnManager({ kind: 'desconocido' as 'mock', ...VPN_CONFIG })).toThrow(
      /desconocido/i,
    );
  });
});

describe('createIotManager', () => {
  it('devuelve un MockIotManager para kind "mock"', () => {
    expect(createIotManager({ kind: 'mock' }).manager).toBeInstanceOf(MockIotManager);
  });

  it('construye un ZigbeeIotManager con su configuración MQTT', () => {
    const iot = createIotManager({ kind: 'zigbee', zigbee: { url: 'mqtt://localhost:1883' } });
    expect(iot.manager).toBeInstanceOf(ZigbeeIotManager);
  });

  it('construye un MatterIotManager con su configuración WebSocket', () => {
    const iot = createIotManager({ kind: 'matter', matter: { url: 'ws://localhost:5580/ws' } });
    expect(iot.manager).toBeInstanceOf(MatterIotManager);
  });

  it('construye un HueIotManager con su configuración', () => {
    const iot = createIotManager({ kind: 'hue', hue: { url: 'https://192.168.1.50', appKey: 'k' } });
    expect(iot.manager).toBeInstanceOf(HueIotManager);
  });

  it('construye un GoveeIotManager (config opcional)', () => {
    expect(createIotManager({ kind: 'govee' }).manager).toBeInstanceOf(GoveeIotManager);
  });

  it('con varios kinds (lista) devuelve un CompositeIotManager', () => {
    const iot = createIotManager({ kind: 'hue,govee', hue: { url: 'https://x', appKey: 'k' } });
    expect(iot.manager).toBeInstanceOf(CompositeIotManager);
  });

  it('lanza si falta la configuración Zigbee/Matter/Hue', () => {
    expect(() => createIotManager({ kind: 'zigbee' })).toThrow(/Zigbee/i);
    expect(() => createIotManager({ kind: 'matter' })).toThrow(/Matter/i);
    expect(() => createIotManager({ kind: 'hue' })).toThrow(/Hue/i);
  });

  it('lanza para un kind desconocido', () => {
    expect(() => createIotManager({ kind: 'desconocido' as 'mock' })).toThrow(/desconocida/i);
  });
});

describe('createCameraManager', () => {
  it('devuelve un MockCameraManager para kind "mock"', () => {
    expect(createCameraManager({ kind: 'mock' })).toBeInstanceOf(MockCameraManager);
  });

  it('construye un RtspCameraManager con su configuración', () => {
    const cameras = createCameraManager({
      kind: 'rtsp',
      rtsp: { configPath: '/tmp/krakenos-cameras-inexistente.json' },
    });
    expect(cameras).toBeInstanceOf(RtspCameraManager);
  });

  it('lanza si falta la configuración RTSP', () => {
    expect(() => createCameraManager({ kind: 'rtsp' })).toThrow(/RTSP/i);
  });

  it('lanza para un kind desconocido', () => {
    expect(() => createCameraManager({ kind: 'desconocido' as 'mock' })).toThrow(/desconocida/i);
  });
});

describe('createFirewallManager', () => {
  it('devuelve un MockFirewallManager para kind "mock"', () => {
    expect(createFirewallManager({ kind: 'mock' })).toBeInstanceOf(MockFirewallManager);
  });

  it('lanza si falta la configuración iptables', () => {
    expect(() => createFirewallManager({ kind: 'iptables' })).toThrow(/iptables/i);
  });

  it('devuelve un IptablesFirewallManager con su configuración', () => {
    const fw = createFirewallManager({
      kind: 'iptables',
      iptables: {
        chain: 'KRAKENOS',
        helperPath: '/usr/local/bin/krakenos-helper',
        ruleStorePath: '/tmp/krakenos-fw.json',
      },
    });
    expect(fw).toBeInstanceOf(IptablesFirewallManager);
  });

  it('lanza para un kind desconocido', () => {
    expect(() => createFirewallManager({ kind: 'desconocido' as 'mock' })).toThrow(/desconocido/i);
  });
});

describe('createVlanManager', () => {
  it('devuelve un MockVlanManager para kind "mock"', () => {
    expect(createVlanManager({ kind: 'mock' })).toBeInstanceOf(MockVlanManager);
  });

  it('construye un SwitchVlanManager con su configuración SNMP', () => {
    const vlan = createVlanManager({
      kind: 'switch',
      switch: { host: '192.168.1.2', storePath: '/tmp/krakenos-vlans.json' },
    });
    expect(vlan).toBeInstanceOf(SwitchVlanManager);
  });

  it('lanza si falta la configuración del switch o el host', () => {
    expect(() => createVlanManager({ kind: 'switch' })).toThrow(/switch|VLAN/i);
    expect(() =>
      createVlanManager({ kind: 'switch', switch: { host: '', storePath: '/tmp/x.json' } }),
    ).toThrow(/VLAN_SWITCH_HOST/);
  });

  it('lanza para un kind desconocido', () => {
    expect(() => createVlanManager({ kind: 'desconocido' as 'mock' })).toThrow(/desconocido/i);
  });
});

describe('createQosManager', () => {
  it('devuelve un MockQosManager para kind "mock"', () => {
    expect(createQosManager({ kind: 'mock' })).toBeInstanceOf(MockQosManager);
  });

  it('lanza si falta la configuración tc', () => {
    expect(() => createQosManager({ kind: 'tc' })).toThrow(/tc|QoS/i);
  });

  it('devuelve un TcQosManager con su configuración', () => {
    const qos = createQosManager({
      kind: 'tc',
      tc: {
        interface: 'eth0',
        linkKbit: 1_000_000,
        helperPath: '/usr/local/bin/krakenos-helper',
        ruleStorePath: '/tmp/krakenos-qos.json',
      },
    });
    expect(qos).toBeInstanceOf(TcQosManager);
  });

  it('lanza para un kind desconocido', () => {
    expect(() => createQosManager({ kind: 'desconocido' as 'mock' })).toThrow(/desconocido/i);
  });
});

describe('createDnsManager', () => {
  it('devuelve un MockDnsManager para kind "mock"', () => {
    expect(createDnsManager({ kind: 'mock' })).toBeInstanceOf(MockDnsManager);
  });

  it('lanza si falta la configuración Pi-hole', () => {
    expect(() => createDnsManager({ kind: 'pihole' })).toThrow(/pi-?hole/i);
  });

  it('devuelve un PiholeDnsManager con su configuración', () => {
    const dns = createDnsManager({
      kind: 'pihole',
      pihole: { baseUrl: 'http://pi.hole', password: 'secret' },
    });
    expect(dns).toBeInstanceOf(PiholeDnsManager);
  });

  it('lanza para un kind desconocido', () => {
    expect(() => createDnsManager({ kind: 'desconocido' as 'mock' })).toThrow(/desconocido/i);
  });
});
