import { chmod, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CorruptJsonStoreError } from '../../src/store/json-store.js';
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

  it('el fichero se crea con permisos 0600 (claves de peers)', async () => {
    await new FilePeerStore(path).add(PEER);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it('devuelve lista vacía si el fichero no existe', async () => {
    expect(await new FilePeerStore(join(tmpdir(), 'krakenos-noexiste.json')).list()).toEqual([]);
  });

  it('un JSON corrupto no se lee como vacío: list rechaza y add no pisa el fichero', async () => {
    await writeFile(path, '{ esto no es json', 'utf8');
    const store = new FilePeerStore(path);
    await expect(store.list()).rejects.toBeInstanceOf(CorruptJsonStoreError);
    await expect(store.add(PEER)).rejects.toBeInstanceOf(CorruptJsonStoreError);
    expect(await readFile(path, 'utf8')).toBe('{ esto no es json');
  });

  it('dos add concurrentes conservan los dos peers', async () => {
    const store = new FilePeerStore(path);
    await Promise.all([
      store.add(PEER),
      store.add({ ...PEER, id: 'p2', publicKey: 'PK2', allowedIps: '10.8.0.3/32' }),
    ]);
    expect((await store.list()).map((p) => p.id).sort()).toEqual(['p1', 'p2']);
  });

  it('un fichero existente con 0644 queda en 0600 tras escribir', async () => {
    await writeFile(path, '[]', 'utf8');
    await chmod(path, 0o644);
    await new FilePeerStore(path).add(PEER);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});
