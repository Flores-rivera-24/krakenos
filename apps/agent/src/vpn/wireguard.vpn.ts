import { randomUUID } from 'node:crypto';
import type {
  CreatePeerRequest,
  CreatePeerResult,
  IsoDateTime,
  VpnManager,
  VpnPeer,
  VpnStatus,
} from '@krakenos/types';
import QRCode from 'qrcode';
import type { CommandRunner } from '../privileged/runner.js';
import type { PeerStore, StoredPeer } from './peer-store.js';
import {
  buildClientConfig,
  nextAddress,
  parseWgDump,
  wgQuickSaveArgs,
  wgSetAddPeerArgs,
  wgSetRemovePeerArgs,
  wgShowDumpArgs,
  wgShowPublicKeyArgs,
  wireguardKeypair,
} from './wireguard.helpers.js';

export interface WireguardOptions {
  runner: CommandRunner;
  store: PeerStore;
  /** Interfaz WireGuard, p. ej. `wg0`. */
  interface: string;
  /** Host público del endpoint. */
  endpoint: string;
  listenPort: number;
  /** Subred de la VPN en CIDR, p. ej. `10.8.0.0/24`. */
  subnet: string;
  /** DNS anunciado a los clientes (normalmente el gateway de la VPN). */
  dns: string;
  /** Clave pública del servidor; si se omite, se consulta a `wg`. */
  serverPublicKey?: string;
}

/** Convierte el handshake unix (segundos) a ISO, o `null` si nunca ocurrió. */
function handshakeToIso(seconds: number | undefined): IsoDateTime | null {
  if (!seconds) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * Gestor de WireGuard real. Construye los comandos (`wg show/set`, `wg-quick
 * save`) y los ejecuta a través del `CommandRunner` privilegiado; el registro
 * de peers (id/nombre/alta) vive en el `PeerStore`. WireGuard es la fuente de
 * verdad del handshake en vivo.
 */
export class WireguardVpnManager implements VpnManager {
  readonly kind = 'wireguard' as const;

  constructor(private readonly opts: WireguardOptions) {}

  private async serverKey(): Promise<string> {
    if (this.opts.serverPublicKey) return this.opts.serverPublicKey;
    const { stdout } = await this.opts.runner.run(wgShowPublicKeyArgs(this.opts.interface));
    return stdout.trim();
  }

  /** Handshakes en vivo por clave pública; vacío si la interfaz no responde. */
  private async liveHandshakes(): Promise<Map<string, number>> {
    try {
      const { stdout } = await this.opts.runner.run(wgShowDumpArgs(this.opts.interface));
      return new Map(parseWgDump(stdout).peers.map((p) => [p.publicKey, p.latestHandshake]));
    } catch {
      return new Map();
    }
  }

  async getStatus(): Promise<VpnStatus> {
    let publicKey = this.opts.serverPublicKey ?? '';
    let enabled = true;
    try {
      const { stdout } = await this.opts.runner.run(wgShowPublicKeyArgs(this.opts.interface));
      if (!publicKey) publicKey = stdout.trim();
    } catch {
      enabled = false;
    }
    const peers = await this.opts.store.list();
    return {
      enabled,
      publicKey,
      endpoint: `${this.opts.endpoint}:${this.opts.listenPort}`,
      listenPort: this.opts.listenPort,
      peerCount: peers.length,
    };
  }

  async listPeers(): Promise<VpnPeer[]> {
    const [stored, handshakes] = await Promise.all([this.opts.store.list(), this.liveHandshakes()]);
    return stored
      .map(
        (p): VpnPeer => ({
          id: p.id,
          name: p.name,
          publicKey: p.publicKey,
          allowedIps: p.allowedIps,
          lastHandshake: handshakeToIso(handshakes.get(p.publicKey)),
          createdAt: p.createdAt,
        }),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async createPeer(input: CreatePeerRequest): Promise<CreatePeerResult> {
    const keys = wireguardKeypair();
    const used = (await this.opts.store.list()).map((p) => p.allowedIps);
    const address = nextAddress(this.opts.subnet, used);

    // Aplica el peer en la interfaz viva y persiste la config de la interfaz.
    await this.opts.runner.run(wgSetAddPeerArgs(this.opts.interface, keys.publicKey, address));
    await this.opts.runner.run(wgQuickSaveArgs(this.opts.interface)).catch(() => undefined);

    const stored: StoredPeer = {
      id: randomUUID(),
      name: input.name,
      publicKey: keys.publicKey,
      allowedIps: `${address}/32`,
      createdAt: new Date().toISOString(),
    };
    await this.opts.store.add(stored);

    const config = buildClientConfig({
      clientPrivateKey: keys.privateKey,
      address,
      dns: this.opts.dns,
      serverPublicKey: await this.serverKey(),
      endpoint: `${this.opts.endpoint}:${this.opts.listenPort}`,
    });
    const qr = await QRCode.toDataURL(config);

    const peer: VpnPeer = {
      id: stored.id,
      name: stored.name,
      publicKey: stored.publicKey,
      allowedIps: stored.allowedIps,
      lastHandshake: null,
      createdAt: stored.createdAt,
    };
    return { peer, config: { config, qr } };
  }

  async removePeer(id: string): Promise<boolean> {
    const removed = await this.opts.store.removeById(id);
    if (!removed) return false;
    // Quita el peer de la interfaz; best-effort si ya no estuviera.
    await this.opts.runner
      .run(wgSetRemovePeerArgs(this.opts.interface, removed.publicKey))
      .catch(() => undefined);
    await this.opts.runner.run(wgQuickSaveArgs(this.opts.interface)).catch(() => undefined);
    return true;
  }
}
