import { describe, expect, it } from 'vitest';
import { MockVpnManager } from '../../src/vpn/mock.vpn.js';

function makeManager() {
  return new MockVpnManager({ endpoint: 'vpn.test', listenPort: 51820 });
}

describe('MockVpnManager', () => {
  it('expone el estado con clave pública y endpoint', async () => {
    const status = await makeManager().getStatus();
    expect(status.enabled).toBe(true);
    expect(status.publicKey).toMatch(/.+/);
    expect(status.endpoint).toBe('vpn.test:51820');
    expect(status.listenPort).toBe(51820);
    expect(status.peerCount).toBe(0);
  });

  it('crea un peer con IP asignada, claves y config + QR', async () => {
    const vpn = makeManager();
    const { peer, config } = await vpn.createPeer({ name: 'Móvil' });

    expect(peer.name).toBe('Móvil');
    expect(peer.allowedIps).toBe('10.8.0.2/32');
    expect(peer.publicKey).toMatch(/.+/);
    expect(peer.lastHandshake).toBeNull();

    expect(config.config).toContain('[Interface]');
    expect(config.config).toContain('PrivateKey = ');
    expect(config.config).toContain('[Peer]');
    expect(config.config).toContain('Endpoint = vpn.test:51820');
    expect(config.qr).toMatch(/^data:image\/png;base64,/);
  });

  it('asigna IPs incrementales y refleja el conteo de peers', async () => {
    const vpn = makeManager();
    const a = await vpn.createPeer({ name: 'A' });
    const b = await vpn.createPeer({ name: 'B' });
    expect(a.peer.allowedIps).toBe('10.8.0.2/32');
    expect(b.peer.allowedIps).toBe('10.8.0.3/32');

    const peers = await vpn.listPeers();
    expect(peers).toHaveLength(2);
    expect((await vpn.getStatus()).peerCount).toBe(2);
  });

  it('elimina un peer (idempotente: false si no existe)', async () => {
    const vpn = makeManager();
    const { peer } = await vpn.createPeer({ name: 'A' });
    expect(await vpn.removePeer(peer.id)).toBe(true);
    expect(await vpn.removePeer(peer.id)).toBe(false);
    expect(await vpn.listPeers()).toHaveLength(0);
  });

  it('genera claves distintas por peer', async () => {
    const vpn = makeManager();
    const a = await vpn.createPeer({ name: 'A' });
    const b = await vpn.createPeer({ name: 'B' });
    expect(a.peer.publicKey).not.toBe(b.peer.publicKey);
  });
});
