import { describe, expect, it } from 'vitest';
import {
  buildLocalApiRequestOptions,
  classifyTransportError,
  detectTailscale,
  parseTailscaleStatusJson,
} from '../../src/vpn/tailscale.js';

const RUNNING = JSON.stringify({
  Version: '1.66.4-t123',
  BackendState: 'Running',
  Self: {
    DNSName: 'krakenos.tail1234.ts.net.',
    TailscaleIPs: ['100.101.102.103', 'fd7a:115c:a1e0::1'],
  },
});

describe('parseTailscaleStatusJson', () => {
  it('mapea un backend Running con IP del tailnet y MagicDNS sin punto final', () => {
    expect(parseTailscaleStatusJson(RUNNING)).toEqual({
      state: 'running',
      tailscaleIp: '100.101.102.103',
      magicDnsName: 'krakenos.tail1234.ts.net',
      version: '1.66.4-t123',
    });
  });

  it('prefiere la IPv4 pero cae a la IPv6 si es la única', () => {
    const onlyV6 = JSON.stringify({
      BackendState: 'Running',
      Self: { DNSName: 'k.ts.net.', TailscaleIPs: ['fd7a:115c:a1e0::1'] },
    });
    expect(parseTailscaleStatusJson(onlyV6).tailscaleIp).toBe('fd7a:115c:a1e0::1');
  });

  it('NeedsLogin/NeedsMachineAuth → needs-login sin datos de red', () => {
    for (const backend of ['NeedsLogin', 'NeedsMachineAuth']) {
      const parsed = parseTailscaleStatusJson(
        JSON.stringify({ BackendState: backend, Self: { TailscaleIPs: ['100.1.2.3'] } }),
      );
      expect(parsed.state).toBe('needs-login');
      expect(parsed.tailscaleIp).toBeNull();
      expect(parsed.magicDnsName).toBeNull();
    }
  });

  it('Stopped u otros backends → stopped', () => {
    expect(parseTailscaleStatusJson(JSON.stringify({ BackendState: 'Stopped' })).state).toBe(
      'stopped',
    );
    expect(parseTailscaleStatusJson(JSON.stringify({ BackendState: 'Starting' })).state).toBe(
      'stopped',
    );
  });

  it('JSON corrupto o sin shape degrada a stopped con nulls, nunca lanza', () => {
    for (const raw of ['{{{', '"texto"', 'null', '[]', '{}']) {
      const parsed = parseTailscaleStatusJson(raw);
      expect(parsed).toEqual({
        state: 'stopped',
        tailscaleIp: null,
        magicDnsName: null,
        version: null,
      });
    }
  });
});

describe('classifyTransportError + detectTailscale', () => {
  const errWith = (code: string) => Object.assign(new Error(code), { code });

  it('socket ausente (ENOENT/ENOTDIR) → not-installed', () => {
    expect(classifyTransportError(errWith('ENOENT'))).toBe('not-installed');
    expect(classifyTransportError(errWith('ENOTDIR'))).toBe('not-installed');
  });

  it('daemon que no responde (ECONNREFUSED, timeout, otros) → stopped', () => {
    expect(classifyTransportError(errWith('ECONNREFUSED'))).toBe('stopped');
    expect(classifyTransportError(new Error('LocalAPI timeout'))).toBe('stopped');
  });

  it('detectTailscale nunca lanza: transporte roto → estado clasificado', async () => {
    const status = await detectTailscale({ fetchStatus: () => Promise.reject(errWith('ENOENT')) });
    expect(status).toEqual({
      state: 'not-installed',
      tailscaleIp: null,
      magicDnsName: null,
      version: null,
    });
  });

  it('detectTailscale con transporte sano devuelve el estado parseado', async () => {
    const status = await detectTailscale({ fetchStatus: () => Promise.resolve(RUNNING) });
    expect(status.state).toBe('running');
    expect(status.magicDnsName).toBe('krakenos.tail1234.ts.net');
  });
});

describe('buildLocalApiRequestOptions (no-egress)', () => {
  it('la petición viaja por socketPath y no lleva host ni puerto de red', () => {
    const options = buildLocalApiRequestOptions('/run/tailscale/tailscaled.sock');
    expect(options.socketPath).toBe('/run/tailscale/tailscaled.sock');
    expect(options.path).toBe('/localapi/v0/status');
    expect(options).not.toHaveProperty('host');
    expect(options).not.toHaveProperty('hostname');
    expect(options).not.toHaveProperty('port');
  });
});
