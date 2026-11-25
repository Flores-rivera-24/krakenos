import { describe, expect, it } from 'vitest';
import { InvalidArgumentError } from '../../src/privileged/validators.js';
import {
  buildClientConfig,
  nextAddress,
  parseWgHandshakes,
  wgSetAddPeerArgs,
  wgSetRemovePeerArgs,
  wgShowLatestHandshakesArgs,
  wireguardKeypair,
} from '../../src/vpn/wireguard.helpers.js';

/** Clave pública WireGuard válida (base64 de 32 bytes) para los casos felices. */
const PUBKEY = wireguardKeypair().publicKey;

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

  it('parsea `wg show <iface> latest-handshakes`', () => {
    const out = 'peerPubA\t1700000000\npeerPubB\t0\n';
    expect(parseWgHandshakes(out)).toEqual(
      new Map([
        ['peerPubA', 1700000000],
        ['peerPubB', 0],
      ]),
    );
    expect(parseWgHandshakes('').size).toBe(0);
  });

  it('asigna la siguiente IP libre saltando las usadas', () => {
    expect(nextAddress('10.8.0.0/24', [])).toBe('10.8.0.2');
    expect(nextAddress('10.8.0.0/24', ['10.8.0.2/32'])).toBe('10.8.0.3');
    expect(nextAddress('10.8.0.0/24', ['10.8.0.2/32', '10.8.0.4/32'])).toBe('10.8.0.3');
  });

  it('construye los argv de wg', () => {
    expect(wgShowLatestHandshakesArgs('wg0')).toEqual(['wg', 'show', 'wg0', 'latest-handshakes']);
    expect(wgSetAddPeerArgs('wg0', PUBKEY, '10.8.0.7')).toEqual([
      'wg',
      'set',
      'wg0',
      'peer',
      PUBKEY,
      'allowed-ips',
      '10.8.0.7/32',
    ]);
    expect(wgSetRemovePeerArgs('wg0', PUBKEY)).toEqual([
      'wg',
      'set',
      'wg0',
      'peer',
      PUBKEY,
      'remove',
    ]);
  });

  // --- Anti-inyección: cada argumento se valida antes de devolver el argv (US-73) ---
  describe('rechazo anti-inyección', () => {
    it('rechaza una interfaz con inyección de bandera o metacaracteres', () => {
      expect(() => wgShowLatestHandshakesArgs('-i')).toThrow(InvalidArgumentError);
      expect(() => wgShowLatestHandshakesArgs('wg0; rm -rf /')).toThrow(InvalidArgumentError);
      expect(() => wgShowLatestHandshakesArgs('wg0 --config')).toThrow(InvalidArgumentError);
      expect(() => wgSetRemovePeerArgs('wg0\nlisten-port 1', PUBKEY)).toThrow(InvalidArgumentError);
    });

    it('rechaza una clave de peer que no sea WireGuard base64', () => {
      expect(() => wgSetAddPeerArgs('wg0', '--remove', '10.8.0.7')).toThrow(InvalidArgumentError);
      expect(() => wgSetAddPeerArgs('wg0', 'no-es-una-clave', '10.8.0.7')).toThrow(
        InvalidArgumentError,
      );
      expect(() => wgSetRemovePeerArgs('wg0', `${PUBKEY} extra`)).toThrow(InvalidArgumentError);
    });

    it('rechaza una IP asignada malformada o con inyección', () => {
      expect(() => wgSetAddPeerArgs('wg0', PUBKEY, '10.8.0.7 fwmark 1')).toThrow(
        InvalidArgumentError,
      );
      expect(() => wgSetAddPeerArgs('wg0', PUBKEY, '999.0.0.1')).toThrow(InvalidArgumentError);
      expect(() => wgSetAddPeerArgs('wg0', PUBKEY, '10.8.0.0/24')).toThrow(InvalidArgumentError);
    });
  });
});
