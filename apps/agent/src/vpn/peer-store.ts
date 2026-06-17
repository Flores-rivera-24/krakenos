import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Registro persistido de un peer (lo que WireGuard no guarda: id, nombre, alta). */
export interface StoredPeer {
  id: string;
  name: string;
  publicKey: string;
  /** IP asignada con máscara, p. ej. `10.8.0.2/32`. */
  allowedIps: string;
  createdAt: string;
}

/**
 * Almacén del registro de peers. WireGuard es la fuente de verdad del estado
 * en vivo (handshake), pero no guarda id/nombre/alta: eso vive aquí.
 */
export interface PeerStore {
  list(): Promise<StoredPeer[]>;
  add(peer: StoredPeer): Promise<void>;
  /** Elimina por id; devuelve el peer borrado o `null` si no existía. */
  removeById(id: string): Promise<StoredPeer | null>;
}

/** Almacén en memoria (tests / arranque efímero). */
export class InMemoryPeerStore implements PeerStore {
  private readonly peers = new Map<string, StoredPeer>();

  async list(): Promise<StoredPeer[]> {
    return [...this.peers.values()];
  }

  async add(peer: StoredPeer): Promise<void> {
    this.peers.set(peer.id, peer);
  }

  async removeById(id: string): Promise<StoredPeer | null> {
    const peer = this.peers.get(id) ?? null;
    if (peer) this.peers.delete(id);
    return peer;
  }
}

/** Almacén respaldado por un fichero JSON (propiedad del agente, no privilegiado). */
export class FilePeerStore implements PeerStore {
  constructor(private readonly path: string) {}

  private async read(): Promise<StoredPeer[]> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as StoredPeer[];
    } catch {
      return [];
    }
  }

  private async write(peers: StoredPeer[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(peers, null, 2), 'utf8');
  }

  async list(): Promise<StoredPeer[]> {
    return this.read();
  }

  async add(peer: StoredPeer): Promise<void> {
    const peers = await this.read();
    peers.push(peer);
    await this.write(peers);
  }

  async removeById(id: string): Promise<StoredPeer | null> {
    const peers = await this.read();
    const idx = peers.findIndex((p) => p.id === id);
    if (idx === -1) return null;
    const [removed] = peers.splice(idx, 1);
    await this.write(peers);
    return removed ?? null;
  }
}
