import { FileJsonStore } from '../store/json-store.js';

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

/**
 * Almacén respaldado por un fichero JSON (propiedad del agente, no privilegiado).
 * Delega en `FileJsonStore`: operaciones serializadas, escritura atómica 0600 y un
 * JSON corrupto rechaza con `CorruptJsonStoreError` en vez de leerse como vacío
 * (que dejaba al siguiente `add` pisando el registro entero).
 */
export class FilePeerStore implements PeerStore {
  private readonly store: FileJsonStore<StoredPeer>;

  constructor(path: string) {
    this.store = new FileJsonStore<StoredPeer>(path);
  }

  list(): Promise<StoredPeer[]> {
    return this.store.list();
  }

  add(peer: StoredPeer): Promise<void> {
    return this.store.upsert(peer);
  }

  removeById(id: string): Promise<StoredPeer | null> {
    return this.store.removeById(id);
  }
}
