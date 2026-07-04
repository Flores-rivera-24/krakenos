/**
 * Caché de mapas de calor de cobertura con **single-flight** y **límite de
 * concurrencia**.
 *
 * El cálculo de un heatmap es caro (propagación RF o interpolación IDW sobre
 * hasta 250k celdas). La ruta `/heatmap` es lectura para cualquier usuario
 * autenticado, así que sin protección un cliente podría forzar recálculos
 * repetidos o en paralelo y saturar la CPU del agente (que corre en hardware
 * modesto). Esta caché cierra tres vectores:
 *
 *  1. **Repetición** — una petición del mismo mapa (misma clave de versión)
 *     devuelve el resultado memoizado en O(1). La clave incluye el `updatedAt`
 *     del plano / el estado del survey, así una edición **invalida** la entrada
 *     automáticamente sin purga explícita.
 *  2. **Concurrencia idéntica** — varias peticiones simultáneas del mismo mapa
 *     comparten un único cálculo en curso (single-flight), no N.
 *  3. **Concurrencia distinta** — un semáforo acota cuántos cálculos pesados
 *     corren a la vez; el resto espera su turno en vez de competir por la CPU.
 *
 * La caché es LRU acotada (`maxEntries`) para no crecer sin límite. Un cálculo
 * que lanza **no** se memoiza (solo se cachea el éxito).
 */
export class HeatmapCache<T> {
  /** Orden de inserción = orden LRU (Map preserva el orden de inserción). */
  private readonly cache = new Map<string, T>();
  /** Cálculos en curso por clave (single-flight). */
  private readonly inflight = new Map<string, Promise<T>>();
  /** Slots de cómputo pesado en uso. */
  private active = 0;
  /** Cola de esperas cuando el semáforo está lleno. */
  private readonly waiters: Array<() => void> = [];

  constructor(
    private readonly maxEntries = 32,
    private readonly maxConcurrent = 2,
  ) {}

  /**
   * Devuelve el valor cacheado para `key`, o lo calcula con `compute` (una sola
   * vez aunque haya peticiones concurrentes) respetando el límite de concurrencia.
   */
  async get(key: string, compute: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      // Refresca la posición LRU (borrar + reinsertar = mover al final).
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const promise = this.runGated(compute)
      .then((result) => {
        this.store(key, result);
        return result;
      })
      .finally(() => {
        this.inflight.delete(key);
      });
    this.inflight.set(key, promise);
    return promise;
  }

  /** Ejecuta `compute` tras adquirir un slot del semáforo, liberándolo al terminar. */
  private async runGated(compute: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await compute();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return;
    }
    // Sin slot libre: espera a que `release` nos ceda el suyo (active no cambia).
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next) {
      next(); // cede el slot directamente al siguiente en cola (active intacto)
    } else {
      this.active--;
    }
  }

  private store(key: string, value: T): void {
    this.cache.set(key, value);
    while (this.cache.size > this.maxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
  }
}
