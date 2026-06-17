import type { Id, IsoDateTime } from './common.js';

/** Implementaciones de gestor de VPN disponibles. */
export type VpnKind = 'mock' | 'wireguard';

/** Estado del servidor WireGuard gestionado por el agente. */
export interface VpnStatus {
  enabled: boolean;
  /** Clave pública del servidor (formato WireGuard base64). */
  publicKey: string;
  /** Endpoint público (host:puerto) al que conectan los peers. */
  endpoint: string | null;
  listenPort: number;
  peerCount: number;
}

/** Peer (dispositivo autorizado) de la VPN. */
export interface VpnPeer {
  id: Id;
  /** Nombre legible asignado por el usuario. */
  name: string;
  /** Clave pública del peer (base64). */
  publicKey: string;
  /** IP asignada dentro de la VPN, p. ej. `10.8.0.2/32`. */
  allowedIps: string;
  /** Último handshake conocido, o `null` si nunca conectó. */
  lastHandshake: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface CreatePeerRequest {
  name: string;
}

/**
 * Configuración de cliente para un peer recién creado. Contiene la clave
 * privada del cliente, por lo que **solo se entrega una vez** (al crear).
 */
export interface PeerConfig {
  /** Texto del archivo `wg0.conf` del cliente. */
  config: string;
  /** Imagen QR del config como data URL (PNG). */
  qr: string;
}

/** Resultado de crear un peer: el peer persistido + su config de un solo uso. */
export interface CreatePeerResult {
  peer: VpnPeer;
  config: PeerConfig;
}

/**
 * Gestor de VPN intercambiable. La implementación real delega las operaciones
 * privilegiadas (wg/iptables) a un helper vía sudoers; `mock` simula en memoria.
 */
export interface VpnManager {
  getStatus(): Promise<VpnStatus>;
  listPeers(): Promise<VpnPeer[]>;
  createPeer(input: CreatePeerRequest): Promise<CreatePeerResult>;
  /** Elimina un peer. Devuelve `false` si no existía. */
  removePeer(id: Id): Promise<boolean>;
}
