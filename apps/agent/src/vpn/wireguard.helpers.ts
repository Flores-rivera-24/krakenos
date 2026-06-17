import { generateKeyPairSync } from 'node:crypto';

/** Genera un par de claves X25519 en formato WireGuard (base64 de 32 bytes raw). */
export function wireguardKeypair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64'),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32).toString('base64'),
  };
}

export interface ClientConfigOptions {
  clientPrivateKey: string;
  /** IP del cliente dentro de la VPN, sin máscara (p. ej. `10.8.0.2`). */
  address: string;
  /** DNS que anunciará el cliente (normalmente el gateway de la VPN). */
  dns: string;
  serverPublicKey: string;
  /** Endpoint público `host:puerto`. */
  endpoint: string;
  /** Rango enrutado por el túnel; por defecto todo el tráfico. */
  allowedIps?: string;
  keepalive?: number;
}

/** Construye el texto `wg0.conf` del cliente. Determinista y testeable. */
export function buildClientConfig(opts: ClientConfigOptions): string {
  return [
    '[Interface]',
    `PrivateKey = ${opts.clientPrivateKey}`,
    `Address = ${opts.address}/32`,
    `DNS = ${opts.dns}`,
    '',
    '[Peer]',
    `PublicKey = ${opts.serverPublicKey}`,
    `Endpoint = ${opts.endpoint}`,
    `AllowedIPs = ${opts.allowedIps ?? '0.0.0.0/0'}`,
    `PersistentKeepalive = ${opts.keepalive ?? 25}`,
    '',
  ].join('\n');
}

/** Peer tal como aparece en `wg show <iface> dump`. */
export interface WgPeerDump {
  publicKey: string;
  allowedIps: string;
  /** Último handshake en segundos unix; `0` = nunca. */
  latestHandshake: number;
}

export interface WgDump {
  publicKey: string | null;
  listenPort: number | null;
  peers: WgPeerDump[];
}

/**
 * Parsea la salida de `wg show <iface> dump`. La primera línea describe la
 * interfaz (clave privada, pública, puerto, fwmark) y el resto son peers.
 */
export function parseWgDump(text: string): WgDump {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) return { publicKey: null, listenPort: null, peers: [] };

  const [, publicKey, listenPort] = lines[0]!.split('\t');
  const peers: WgPeerDump[] = lines.slice(1).map((line) => {
    const f = line.split('\t');
    return {
      publicKey: f[0] ?? '',
      allowedIps: f[3] ?? '',
      latestHandshake: Number(f[4] ?? 0) || 0,
    };
  });

  return {
    publicKey: publicKey || null,
    listenPort: listenPort ? Number(listenPort) : null,
    peers,
  };
}

/**
 * Calcula la siguiente IP libre del rango (IPv4 /24). El `.1` se reserva para
 * el servidor; se empieza a asignar desde `.2`.
 */
export function nextAddress(subnetCidr: string, usedIps: string[]): string {
  const base = subnetCidr.split('/')[0]!; // p. ej. 10.8.0.0
  const prefix = base.split('.').slice(0, 3).join('.'); // 10.8.0
  const used = new Set(
    usedIps.map((ip) => Number(ip.split('/')[0]!.split('.')[3] ?? -1)).filter((n) => n >= 0),
  );
  let host = 2;
  while (used.has(host)) host++;
  if (host > 254) throw new Error('No quedan direcciones libres en la subred');
  return `${prefix}.${host}`;
}

// --- Constructores de argv (puros) para el helper privilegiado ---

export const wgShowDumpArgs = (iface: string): string[] => ['wg', 'show', iface, 'dump'];

export const wgShowPublicKeyArgs = (iface: string): string[] => ['wg', 'show', iface, 'public-key'];

export const wgSetAddPeerArgs = (iface: string, publicKey: string, address: string): string[] => [
  'wg',
  'set',
  iface,
  'peer',
  publicKey,
  'allowed-ips',
  `${address}/32`,
];

export const wgSetRemovePeerArgs = (iface: string, publicKey: string): string[] => [
  'wg',
  'set',
  iface,
  'peer',
  publicKey,
  'remove',
];

export const wgQuickSaveArgs = (iface: string): string[] => ['wg-quick', 'save', iface];
