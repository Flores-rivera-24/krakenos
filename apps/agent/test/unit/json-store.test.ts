import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileJsonStore, MemoryJsonStore } from '../../src/store/json-store.js';

interface Item {
  id: string;
  v: number;
}

describe('MemoryJsonStore', () => {
  it('inserta, reemplaza por id, obtiene y elimina', async () => {
    const store = new MemoryJsonStore<Item>();
    await store.upsert({ id: 'a', v: 1 });
    await store.upsert({ id: 'a', v: 2 }); // reemplaza
    expect(await store.list()).toHaveLength(1);
    expect((await store.get('a'))?.v).toBe(2);
    expect((await store.removeById('a'))?.v).toBe(2);
    expect(await store.removeById('a')).toBeNull();
  });
});

describe('FileJsonStore', () => {
  const path = join(tmpdir(), 'krakenos-jsonstore.test.json');
  afterEach(async () => rm(path, { force: true }));

  it('persiste entre instancias', async () => {
    await new FileJsonStore<Item>(path).upsert({ id: 'a', v: 1 });
    const reopened = new FileJsonStore<Item>(path);
    await reopened.upsert({ id: 'b', v: 2 });
    expect(await reopened.list()).toHaveLength(2);
    expect((await reopened.removeById('a'))?.v).toBe(1);
    expect(await reopened.list()).toHaveLength(1);
  });
});
