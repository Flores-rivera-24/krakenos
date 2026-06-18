import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface Identifiable {
  id: string;
}

/** Almacén de una colección de entidades con `id`. */
export interface JsonStore<T extends Identifiable> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  /** Inserta o reemplaza por `id`. */
  upsert(item: T): Promise<void>;
  /** Elimina por `id`; devuelve la entidad borrada o `null`. */
  removeById(id: string): Promise<T | null>;
}

/** Implementación en memoria (tests / arranque efímero). */
export class MemoryJsonStore<T extends Identifiable> implements JsonStore<T> {
  private readonly items = new Map<string, T>();

  async list(): Promise<T[]> {
    return [...this.items.values()];
  }

  async get(id: string): Promise<T | null> {
    return this.items.get(id) ?? null;
  }

  async upsert(item: T): Promise<void> {
    this.items.set(item.id, item);
  }

  async removeById(id: string): Promise<T | null> {
    const item = this.items.get(id) ?? null;
    if (item) this.items.delete(id);
    return item;
  }
}

/** Implementación respaldada por un fichero JSON (propiedad del agente). */
export class FileJsonStore<T extends Identifiable> implements JsonStore<T> {
  constructor(private readonly path: string) {}

  private async read(): Promise<T[]> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as T[];
    } catch {
      return [];
    }
  }

  private async write(items: T[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(items, null, 2), 'utf8');
  }

  async list(): Promise<T[]> {
    return this.read();
  }

  async get(id: string): Promise<T | null> {
    return (await this.read()).find((i) => i.id === id) ?? null;
  }

  async upsert(item: T): Promise<void> {
    const items = await this.read();
    const idx = items.findIndex((i) => i.id === item.id);
    if (idx === -1) items.push(item);
    else items[idx] = item;
    await this.write(items);
  }

  async removeById(id: string): Promise<T | null> {
    const items = await this.read();
    const idx = items.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    const [removed] = items.splice(idx, 1);
    await this.write(items);
    return removed ?? null;
  }
}
