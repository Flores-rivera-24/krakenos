import { describe, expect, it } from 'vitest';
import { MockCameraManager, createCameraManager } from '../../src/cameras/index.js';
import { MockFirewallManager, createFirewallManager } from '../../src/firewall/index.js';
import { MockIotManager, createIotManager } from '../../src/iot/index.js';
import { MockVlanManager, createVlanManager } from '../../src/vlan/index.js';
import { MockVpnManager, createVpnManager } from '../../src/vpn/index.js';

const VPN_CONFIG = { endpoint: 'vpn.test', listenPort: 51820 } as const;

describe('createVpnManager', () => {
  it('devuelve un MockVpnManager para kind "mock"', () => {
    const vpn = createVpnManager({ kind: 'mock', ...VPN_CONFIG });
    expect(vpn).toBeInstanceOf(MockVpnManager);
  });

  it('lanza para el gestor wireguard real (pendiente)', () => {
    expect(() => createVpnManager({ kind: 'wireguard', ...VPN_CONFIG })).toThrow(/WireGuard/i);
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
