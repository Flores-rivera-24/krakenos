import { beforeEach, describe, expect, it } from 'vitest';
import type { CommandResult, CommandRunner } from '../../src/privileged/runner.js';
import { InMemoryPeerStore } from '../../src/vpn/peer-store.js';
import { WireguardVpnManager } from '../../src/vpn/wireguard.vpn.js';

/** Runner falso: registra los argv y responde según una tabla por comando. */
class FakeRunner implements CommandRunner {
  calls: string[][] = [];
  responses: Record<string, string> = {};
  failing = new Set<string>();

  async run(argv: string[]): Promise<CommandResult> {
    this.calls.push(argv);
    const key = argv.join(' ');
    if (this.failing.has(key)) throw new Error('boom');
    return { stdout: this.responses[key] ?? '', stderr: '', code: 0 };
  }

  called(prefix: string): boolean {
    return this.calls.some((c) => c.join(' ').startsWith(prefix));
  }
}

function makeManager(runner: FakeRunner, store = new InMemoryPeerStore()) {
  return new WireguardVpnManager({
    runner,
    store,
    interface: 'wg0',
    endpoint: 'vpn.test',
    listenPort: 51820,
    subnet: '10.8.0.0/24',
    dns: '10.8.0.1',
    serverPublicKey: 'SERVERPUB',
  });
}

describe('WireguardVpnManager', () => {
  let runner: FakeRunner;

  beforeEach(() => {
    runner = new FakeRunner();
  });

  it('crea un peer: asigna IP, aplica `wg set` y devuelve config + QR', async () => {
    const vpn = makeManager(runner);
    const { peer, config } = await vpn.createPeer({ name: 'Móvil' });

    expect(peer.name).toBe('Móvil');
    expect(peer.allowedIps).toBe('10.8.0.2/32');
    expect(peer.lastHandshake).toBeNull();
    expect(config.config).toContain('Endpoint = vpn.test:51820');
    expect(config.config).toContain('PublicKey = SERVERPUB');
    expect(config.qr).toMatch(/^data:image\/png;base64,/);

    // Aplicó el peer en la interfaz viva.
    expect(runner.called(`wg set wg0 peer ${peer.publicKey} allowed-ips 10.8.0.2/32`)).toBe(true);
    expect(await vpn.listPeers()).toHaveLength(1);
  });

  it('asigna IPs incrementales', async () => {
    const vpn = makeManager(runner);
    const a = await vpn.createPeer({ name: 'A' });
    const b = await vpn.createPeer({ name: 'B' });
    expect(a.peer.allowedIps).toBe('10.8.0.2/32');
    expect(b.peer.allowedIps).toBe('10.8.0.3/32');
  });

  it('lista peers fusionando el handshake en vivo de `wg show dump`', async () => {
    const vpn = makeManager(runner);
    const { peer } = await vpn.createPeer({ name: 'Portátil' });
    runner.responses['wg show wg0 dump'] = [
      'priv\tSERVERPUB\t51820\toff',
      `${peer.publicKey}\t(none)\t1.2.3.4:5\t10.8.0.2/32\t1700000000\t0\t0\toff`,
    ].join('\n');

    const peers = await vpn.listPeers();
    expect(peers[0]!.lastHandshake).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it('elimina un peer: quita de la interfaz y es idempotente', async () => {
    const vpn = makeManager(runner);
    const { peer } = await vpn.createPeer({ name: 'A' });

    expect(await vpn.removePeer(peer.id)).toBe(true);
    expect(runner.called(`wg set wg0 peer ${peer.publicKey} remove`)).toBe(true);
    expect(await vpn.removePeer(peer.id)).toBe(false);
    expect(await vpn.listPeers()).toHaveLength(0);
  });

  it('getStatus refleja peerCount y marca enabled=false si la interfaz no responde', async () => {
    const store = new InMemoryPeerStore();
    const vpn = makeManager(runner, store);
    await vpn.createPeer({ name: 'A' });

    const ok = await vpn.getStatus();
    expect(ok.enabled).toBe(true);
    expect(ok.publicKey).toBe('SERVERPUB');
    expect(ok.peerCount).toBe(1);

    runner.failing.add('wg show wg0 public-key');
    expect((await vpn.getStatus()).enabled).toBe(false);
  });
});
