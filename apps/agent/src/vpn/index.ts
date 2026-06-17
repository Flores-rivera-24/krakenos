import type { VpnKind, VpnManager } from '@krakenos/types';
import { SudoHelperRunner } from '../privileged/runner.js';
import { MockVpnManager } from './mock.vpn.js';
import { FilePeerStore } from './peer-store.js';
import { WireguardVpnManager } from './wireguard.vpn.js';

/** Config específica del gestor WireGuard real (`kind: 'wireguard'`). */
export interface WireguardManagerConfig {
  interface: string;
  subnet: string;
  dns: string;
  helperPath: string;
  useSudo?: boolean;
  /** Fichero JSON donde se persiste el registro de peers. */
  peerStorePath: string;
  serverPublicKey?: string;
}

export interface VpnConfig {
  kind: VpnKind;
  endpoint: string;
  listenPort: number;
  /** Requerido cuando `kind === 'wireguard'`. */
  wireguard?: WireguardManagerConfig;
}

/**
 * Construye el gestor de VPN según la configuración. El resto del agente solo
 * conoce la interfaz `VpnManager`. `mock` simula en memoria; `wireguard` opera
 * un servidor real delegando los comandos privilegiados (`wg`/`wg-quick`) al
 * helper vía sudoers.
 */
export function createVpnManager(config: VpnConfig): VpnManager {
  switch (config.kind) {
    case 'mock':
      return new MockVpnManager({ endpoint: config.endpoint, listenPort: config.listenPort });
    case 'wireguard': {
      const wg = config.wireguard;
      if (!wg) throw new Error('Falta la configuración WireGuard (VpnConfig.wireguard)');
      return new WireguardVpnManager({
        runner: new SudoHelperRunner({ helperPath: wg.helperPath, useSudo: wg.useSudo }),
        store: new FilePeerStore(wg.peerStorePath),
        interface: wg.interface,
        endpoint: config.endpoint,
        listenPort: config.listenPort,
        subnet: wg.subnet,
        dns: wg.dns,
        serverPublicKey: wg.serverPublicKey,
      });
    }
    default: {
      const exhaustive: never = config.kind;
      throw new Error(`Gestor de VPN desconocido: ${String(exhaustive)}`);
    }
  }
}

export { MockVpnManager } from './mock.vpn.js';
export { WireguardVpnManager } from './wireguard.vpn.js';
