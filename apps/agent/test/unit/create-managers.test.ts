import { describe, expect, it } from 'vitest';
import { MockCameraManager, createCameraManager } from '../../src/cameras/index.js';
import { MockDnsManager, createDnsManager } from '../../src/dns/index.js';
import { MockFirewallManager, createFirewallManager } from '../../src/firewall/index.js';
import { MockIotManager, createIotManager } from '../../src/iot/index.js';
import { MockQosManager, createQosManager } from '../../src/qos/index.js';
import { MockVlanManager, createVlanManager } from '../../src/vlan/index.js';
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
    expect(createIotManager({ kind: 'mock' })).toBeInstanceOf(MockIotManager);
  });

  it('lanza para integraciones reales aún no implementadas', () => {
    expect(() => createIotManager({ kind: 'zigbee' })).toThrow(/Zigbee/i);
    expect(() => createIotManager({ kind: 'matter' })).toThrow(/Matter/i);
  });

  it('lanza para un kind desconocido', () => {
    expect(() => createIotManager({ kind: 'desconocido' as 'mock' })).toThrow(/desconocida/i);
  });
});

describe('createCameraManager', () => {
  it('devuelve un MockCameraManager para kind "mock"', () => {
    expect(createCameraManager({ kind: 'mock' })).toBeInstanceOf(MockCameraManager);
  });

  it('lanza para la fuente RTSP real (pendiente)', () => {
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

  it('lanza para el gestor iptables real (pendiente)', () => {
    expect(() => createFirewallManager({ kind: 'iptables' })).toThrow(/iptables/i);
  });

  it('lanza para un kind desconocido', () => {
    expect(() => createFirewallManager({ kind: 'desconocido' as 'mock' })).toThrow(/desconocido/i);
  });
});

describe('createVlanManager', () => {
  it('devuelve un MockVlanManager para kind "mock"', () => {
    expect(createVlanManager({ kind: 'mock' })).toBeInstanceOf(MockVlanManager);
  });

  it('lanza para el gestor de switch real (pendiente)', () => {
    expect(() => createVlanManager({ kind: 'switch' })).toThrow(/switch|VLAN/i);
  });

  it('lanza para un kind desconocido', () => {
    expect(() => createVlanManager({ kind: 'desconocido' as 'mock' })).toThrow(/desconocido/i);
  });
});

describe('createQosManager', () => {
  it('devuelve un MockQosManager para kind "mock"', () => {
    expect(createQosManager({ kind: 'mock' })).toBeInstanceOf(MockQosManager);
  });

  it('lanza para el gestor tc real (pendiente)', () => {
    expect(() => createQosManager({ kind: 'tc' })).toThrow(/tc|QoS/i);
  });

  it('lanza para un kind desconocido', () => {
    expect(() => createQosManager({ kind: 'desconocido' as 'mock' })).toThrow(/desconocido/i);
  });
});

describe('createDnsManager', () => {
  it('devuelve un MockDnsManager para kind "mock"', () => {
    expect(createDnsManager({ kind: 'mock' })).toBeInstanceOf(MockDnsManager);
  });

  it('lanza para el gestor Pi-hole real (pendiente)', () => {
    expect(() => createDnsManager({ kind: 'pihole' })).toThrow(/pi-?hole/i);
  });

  it('lanza para un kind desconocido', () => {
    expect(() => createDnsManager({ kind: 'desconocido' as 'mock' })).toThrow(/desconocido/i);
  });
});
