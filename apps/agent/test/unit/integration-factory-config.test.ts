import { describe, expect, it } from 'vitest';
import {
  resolveDnsConfig,
  resolveDriverConfig,
  resolveIotConfig,
  resolveVlanConfig,
} from '../../src/integrations/factory-config.js';

describe('factory-config — precedencia DB sobre .env y mapeo plano→factory (US-140)', () => {
  it('sin registro devuelve la config de env (fallback: mock por defecto en tests)', () => {
    expect(resolveDriverConfig(null).kind).toBe('mock');
    expect(resolveDnsConfig(null).kind).toBe('mock');
    expect(resolveIotConfig(null).kind).toBe('mock');
  });

  it('driver openwrt: mapea campos planos al shape anidado ssh + aplica defaults', () => {
    const cfg = resolveDriverConfig({
      kind: 'openwrt',
      values: {
        host: '192.168.1.1',
        username: 'root',
        password: 'secreto',
        sshPort: '2222', // string → coerción a número
        wanInterface: 'eth1',
      },
    });
    expect(cfg.kind).toBe('openwrt');
    expect(cfg.host).toBe('192.168.1.1');
    expect(cfg.openwrt!.ssh.host).toBe('192.168.1.1');
    expect(cfg.openwrt!.ssh.port).toBe(2222);
    expect(cfg.openwrt!.ssh.username).toBe('root');
    expect(cfg.openwrt!.ssh.password).toBe('secreto');
    expect(cfg.openwrt!.wanInterface).toBe('eth1');
    expect(cfg.openwrt!.guestNetwork).toBe('guest'); // default conservado
  });

  it('iot con varios backends: claves namespaced backend.campo', () => {
    const cfg = resolveIotConfig({
      kind: 'hue,govee',
      values: {
        'hue.bridgeUrl': 'https://192.168.1.50',
        'hue.appKey': 'app-key-abc',
        'govee.listenPort': 5000,
      },
    });
    expect(cfg.kind).toBe('hue,govee');
    expect(cfg.hue!.url).toBe('https://192.168.1.50');
    expect(cfg.hue!.appKey).toBe('app-key-abc');
    expect(cfg.govee!.listenPort).toBe(5000);
  });

  it('dns pihole y vlan cisco mapean sus campos', () => {
    const dns = resolveDnsConfig({ kind: 'pihole', values: { baseUrl: 'http://pi.casa', password: 'pw' } });
    expect(dns.kind).toBe('pihole');
    expect(dns.pihole!.baseUrl).toBe('http://pi.casa');
    expect(dns.pihole!.password).toBe('pw');

    const vlan = resolveVlanConfig({ kind: 'cisco', values: { host: '10.0.0.1', password: 'p' } });
    expect(vlan.kind).toBe('cisco');
    expect(vlan.cisco!.host).toBe('10.0.0.1');
    expect(vlan.cisco!.password).toBe('p');
  });
});
