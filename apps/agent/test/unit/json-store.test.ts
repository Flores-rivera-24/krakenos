import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CorruptJsonStoreError,
  FileJsonStore,
  MemoryJsonStore,
} from '../../src/store/json-store.js';

/** root ignora los bits de permiso → el test de permisos no aplica. */
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;

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
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'krakenos-jsonstore-'));
    path = join(dir, 'store.json');
  });

  afterEach(async () => rm(dir, { recursive: true, force: true }));

  it('persiste entre instancias', async () => {
    await new FileJsonStore<Item>(path).upsert({ id: 'a', v: 1 });
    const reopened = new FileJsonStore<Item>(path);
    await reopened.upsert({ id: 'b', v: 2 });
    expect(await reopened.list()).toHaveLength(2);
    expect((await reopened.removeById('a'))?.v).toBe(1);
    expect(await reopened.list()).toHaveLength(1);
  });

  it('list() devuelve [] si el fichero no existe (no es corrupción, US-52)', async () => {
    expect(await new FileJsonStore<Item>(path).list()).toEqual([]);
  });

  it('50 upsert concurrentes conservan los 50 (serialización, US-52)', async () => {
    const store = new FileJsonStore<Item>(path);
    await Promise.all(
      Array.from({ length: 50 }, (_, i) => store.upsert({ id: `id-${i}`, v: i })),
    );
    const all = await store.list();
    expect(all).toHaveLength(50);
    expect(new Set(all.map((i) => i.id)).size).toBe(50);
  });

  it('JSON corrupto no se traga: lanza CorruptJsonStoreError y no sobrescribe (US-52)', async () => {
    const corrupt = '{ esto no es json válido';
    await writeFile(path, corrupt, 'utf8');
    const store = new FileJsonStore<Item>(path);

    await expect(store.list()).rejects.toBeInstanceOf(CorruptJsonStoreError);
    // upsert tampoco pisa el fichero dañado con datos parciales.
    await expect(store.upsert({ id: 'a', v: 1 })).rejects.toBeInstanceOf(CorruptJsonStoreError);
    expect(await readFile(path, 'utf8')).toBe(corrupt);
  });

  it.skipIf(isRoot)('read() propaga un error de permisos, no lo traga como vacío (US-61)', async () => {
    await writeFile(path, '[{"id":"a","v":1}]', 'utf8');
    await chmod(path, 0o000); // sin permiso de lectura
    try {
      // No debe devolver [] en silencio: el error de E/S se propaga.
      await expect(new FileJsonStore<Item>(path).list()).rejects.toThrow();
    } finally {
      await chmod(path, 0o600); // restaura para que afterEach pueda borrar
    }
  });

  it('escritura atómica: no deja temporales y el contenido es JSON válido (US-52)', async () => {
    const store = new FileJsonStore<Item>(path);
    await store.upsert({ id: 'a', v: 1 });
    await store.upsert({ id: 'b', v: 2 });
    await store.removeById('a');

    const files = await readdir(dir);
    expect(files).toContain('store.json');
    expect(files.filter((f) => f.endsWith('.tmp'))).toEqual([]); // sin temporales huérfanos
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([{ id: 'b', v: 2 }]);
  });
});
