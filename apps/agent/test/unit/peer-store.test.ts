import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FilePeerStore, InMemoryPeerStore, type StoredPeer } from '../../src/vpn/peer-store.js';

const PEER: StoredPeer = {
  id: 'p1',
  name: 'Móvil',
  publicKey: 'PK1',
  allowedIps: '10.8.0.2/32',
  createdAt: '2026-06-17T00:00:00.000Z',
};

describe('InMemoryPeerStore', () => {
  it('añade, lista y elimina por id', async () => {
    const store = new InMemoryPeerStore();
    await store.add(PEER);
    expect(await store.list()).toHaveLength(1);
    expect((await store.removeById('p1'))?.publicKey).toBe('PK1');
    expect(await store.removeById('p1')).toBeNull();
    expect(await store.list()).toHaveLength(0);
  });
});

describe('FilePeerStore', () => {
  const path = join(tmpdir(), 'krakenos-peerstore.test.json');

  afterEach(async () => {
    await rm(path, { force: true });
  });

  it('persiste el registro entre instancias y elimina por id', async () => {
    await new FilePeerStore(path).add(PEER);

    // Una instancia nueva lee el mismo fichero.
    const reopened = new FilePeerStore(path);
    expect(await reopened.list()).toHaveLength(1);
    expect((await reopened.removeById('p1'))?.name).toBe('Móvil');
    expect(await reopened.list()).toHaveLength(0);
  });

  it('devuelve lista vacía si el fichero no existe', async () => {
    expect(await new FilePeerStore(join(tmpdir(), 'krakenos-noexiste.json')).list()).toEqual([]);
  });
});
