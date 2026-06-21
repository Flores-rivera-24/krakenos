import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
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

/**
 * El fichero del store existe pero su contenido no es JSON válido (US-52). Se
 * lanza en vez de devolver una colección vacía, de modo que un fichero corrupto
 * **no** se traga en silencio (ni se sobrescribe con datos parciales): el fichero
 * se conserva intacto para poder recuperarlo a mano.
 */
export class CorruptJsonStoreError extends Error {
  constructor(
    readonly path: string,
    cause?: unknown,
  ) {
    super(`Fichero de store con JSON corrupto: ${path}`, { cause });
    this.name = 'CorruptJsonStoreError';
  }
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

/**
 * Implementación respaldada por un fichero JSON (propiedad del agente).
 *
 * Garantías (US-52):
 * - **Serializada**: todas las operaciones de una instancia pasan por una cadena de
 *   promesas, de modo que los ciclos leer-mutar-escribir nunca se solapan (dos
 *   `upsert` concurrentes no se pisan ni pierden uno).
 * - **Atómica**: cada escritura va a un fichero temporal con `fsync` y luego un
 *   `rename` atómico, así un crash a media escritura no deja el fichero corrupto.
 * - **Sin pérdidas silenciosas**: un JSON corrupto lanza `CorruptJsonStoreError`
 *   en vez de devolver vacío (y por tanto sin sobrescribir el fichero dañado).
 */
export class FileJsonStore<T extends Identifiable> implements JsonStore<T> {
  /**
   * Cola de serialización: el promise almacenado nunca rechaza, así un fallo en una
   * operación no rompe la cadena ni bloquea las siguientes.
   */
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string) {}

  /** Encola `op` detrás de las operaciones previas y devuelve su resultado. */
  private enqueue<R>(op: () => Promise<R>): Promise<R> {
    const result = this.tail.then(op, op);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async read(): Promise<T[]> {
    let raw: string;
    try {
      raw = await readFile(this.path, 'utf8');
    } catch (err) {
      // Fichero inexistente → store vacío. Cualquier otro error de E/S (permisos,
      // etc.) se propaga: no se enmascara como vacío.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
    try {
      return JSON.parse(raw) as T[];
    } catch (err) {
      throw new CorruptJsonStoreError(this.path, { cause: err });
    }
  }

  /** Escritura atómica: fichero temporal único + `fsync` + `rename` (US-52). */
  private async write(items: T[]): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${randomUUID()}.tmp`;
    try {
      const handle = await open(tmp, 'w');
      try {
        await handle.writeFile(JSON.stringify(items, null, 2), 'utf8');
        // fsync: asegura que el contenido llega a disco antes de hacerlo visible.
        await handle.sync();
      } finally {
        await handle.close();
      }
      // `rename` es atómico en el mismo sistema de ficheros: el lector ve el
      // fichero anterior íntegro o el nuevo íntegro, nunca uno a medio escribir.
      await rename(tmp, this.path);
    } catch (err) {
      // No dejar temporales huérfanos si algo falla.
      await rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  async list(): Promise<T[]> {
    return this.enqueue(() => this.read());
  }

  async get(id: string): Promise<T | null> {
    return this.enqueue(async () => (await this.read()).find((i) => i.id === id) ?? null);
  }

  async upsert(item: T): Promise<void> {
    return this.enqueue(async () => {
      const items = await this.read();
      const idx = items.findIndex((i) => i.id === item.id);
      if (idx === -1) items.push(item);
      else items[idx] = item;
      await this.write(items);
    });
  }

  async removeById(id: string): Promise<T | null> {
    return this.enqueue(async () => {
      const items = await this.read();
      const idx = items.findIndex((i) => i.id === id);
      if (idx === -1) return null;
      const [removed] = items.splice(idx, 1);
      await this.write(items);
      return removed ?? null;
    });
  }
}
