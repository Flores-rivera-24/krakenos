import type {
  CreatePeerRequest,
  CreatePeerResult,
  VpnManager,
  VpnPeer,
  VpnStatus,
} from '@krakenos/types';
import { DomainNotConfiguredError } from '../integrations/not-configured.js';

/** VPN «sin configurar» (`VPN_KIND=none`): sin servidor, sin peers; crear uno es un 409. */
export class NoneVpnManager implements VpnManager {
  readonly kind = 'none' as const;
  readonly notConfigured = true as const;

  constructor(private readonly opts: { listenPort: number }) {}

  async getStatus(): Promise<VpnStatus> {
    return {
      enabled: false,
      publicKey: '',
      endpoint: null,
      listenPort: this.opts.listenPort,
      peerCount: 0,
    };
  }

  async listPeers(): Promise<VpnPeer[]> {
    return [];
  }

  async createPeer(_input: CreatePeerRequest): Promise<CreatePeerResult> {
    throw new DomainNotConfiguredError('vpn');
  }

  async removePeer(_id: string): Promise<boolean> {
    throw new DomainNotConfiguredError('vpn');
  }
}
