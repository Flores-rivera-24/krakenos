import { describe, expect, it } from 'vitest';
import {
  buildClientConfig,
  nextAddress,
  parseWgDump,
  wgSetAddPeerArgs,
  wgSetRemovePeerArgs,
  wgShowDumpArgs,
  wireguardKeypair,
} from '../../src/vpn/wireguard.helpers.js';

describe('wireguard helpers', () => {
  it('genera claves X25519 base64 distintas', () => {
    const a = wireguardKeypair();
    const b = wireguardKeypair();
    expect(a.publicKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(a.privateKey).toMatch(/^[A-Za-z0-9+/]{43}=$/);
    expect(a.publicKey).not.toBe(b.publicKey);
  });

  it('construye una config de cliente válida', () => {
    const cfg = buildClientConfig({
      clientPrivateKey: 'PRIV',
      address: '10.8.0.5',
      dns: '10.8.0.1',
      serverPublicKey: 'SRV',
      endpoint: 'vpn.test:51820',
    });
    expect(cfg).toContain('[Interface]');
    expect(cfg).toContain('PrivateKey = PRIV');
    expect(cfg).toContain('Address = 10.8.0.5/32');
    expect(cfg).toContain('[Peer]');
    expect(cfg).toContain('PublicKey = SRV');
    expect(cfg).toContain('Endpoint = vpn.test:51820');
    expect(cfg).toContain('AllowedIPs = 0.0.0.0/0');
  });

  it('parsea la salida de `wg show <iface> dump`', () => {
    const dump = [
      'serverPriv\tserverPub\t51820\toff',
      'peerPubA\t(none)\t1.2.3.4:5\t10.8.0.2/32\t1700000000\t128\t256\toff',
      'peerPubB\t(none)\t(none)\t10.8.0.3/32\t0\t0\t0\toff',
    ].join('\n');
    const parsed = parseWgDump(dump);
    expect(parsed.publicKey).toBe('serverPub');
    expect(parsed.listenPort).toBe(51820);
    expect(parsed.peers).toHaveLength(2);
    expect(parsed.peers[0]).toEqual({
      publicKey: 'peerPubA',
      allowedIps: '10.8.0.2/32',
      latestHandshake: 1700000000,
    });
    expect(parsed.peers[1]!.latestHandshake).toBe(0);
  });

  it('devuelve dump vacío para entrada vacía', () => {
    expect(parseWgDump('')).toEqual({ publicKey: null, listenPort: null, peers: [] });
  });

  it('asigna la siguiente IP libre saltando las usadas', () => {
    expect(nextAddress('10.8.0.0/24', [])).toBe('10.8.0.2');
    expect(nextAddress('10.8.0.0/24', ['10.8.0.2/32'])).toBe('10.8.0.3');
    expect(nextAddress('10.8.0.0/24', ['10.8.0.2/32', '10.8.0.4/32'])).toBe('10.8.0.3');
  });

  it('construye los argv de wg', () => {
    expect(wgShowDumpArgs('wg0')).toEqual(['wg', 'show', 'wg0', 'dump']);
    expect(wgSetAddPeerArgs('wg0', 'PK', '10.8.0.7')).toEqual([
      'wg', 'set', 'wg0', 'peer', 'PK', 'allowed-ips', '10.8.0.7/32',
    ]);
    expect(wgSetRemovePeerArgs('wg0', 'PK')).toEqual(['wg', 'set', 'wg0', 'peer', 'PK', 'remove']);
  });
});
