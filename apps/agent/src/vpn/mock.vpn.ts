import { randomUUID } from 'node:crypto';
import type {
  CreatePeerRequest,
  CreatePeerResult,
  VpnManager,
  VpnPeer,
  VpnStatus,
} from '@krakenos/types';
import QRCode from 'qrcode';
import { buildClientConfig, wireguardKeypair } from './wireguard.helpers.js';

interface MockVpnOptions {
  endpoint: string;
  listenPort: number;
}

/**
 * Gestor de VPN en memoria para desarrollo. Genera claves X25519 reales y
 * configs WireGuard válidas, sin necesidad de tener `wg` instalado.
 */
export class MockVpnManager implements VpnManager {
  readonly kind = 'mock' as const;
  private readonly server = wireguardKeypair();
  private readonly peers = new Map<string, VpnPeer>();
  private nextHost = 2; // 10.8.0.1 es el servidor

  constructor(private readonly opts: MockVpnOptions) {}

  async getStatus(): Promise<VpnStatus> {
    return {
      enabled: true,
      publicKey: this.server.publicKey,
      endpoint: `${this.opts.endpoint}:${this.opts.listenPort}`,
      listenPort: this.opts.listenPort,
      peerCount: this.peers.size,
    };
  }

  async listPeers(): Promise<VpnPeer[]> {
    return [...this.peers.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createPeer(input: CreatePeerRequest): Promise<CreatePeerResult> {
    const keys = wireguardKeypair();
    const host = this.nextHost++;
    const address = `10.8.0.${host}`;

    const peer: VpnPeer = {
      id: randomUUID(),
      name: input.name,
      publicKey: keys.publicKey,
      allowedIps: `${address}/32`,
      lastHandshake: null,
      createdAt: new Date().toISOString(),
    };
    this.peers.set(peer.id, peer);

    const config = buildClientConfig({
      clientPrivateKey: keys.privateKey,
      address,
      dns: '10.8.0.1',
      serverPublicKey: this.server.publicKey,
      endpoint: `${this.opts.endpoint}:${this.opts.listenPort}`,
    });

    const qr = await QRCode.toDataURL(config);
    return { peer, config: { config, qr } };
  }

  async removePeer(id: string): Promise<boolean> {
    return this.peers.delete(id);
  }
}
