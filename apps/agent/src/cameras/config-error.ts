import { CorruptJsonStoreError, type Identifiable, type JsonStore } from '../store/json-store.js';

/**
 * El fichero de cámaras existe pero está dañado. Es un 5xx DELIBERADO con `code`
 * propio, así que `plugins/error-handler.ts` conserva su estado y su mensaje (copy
 * nuestro, sin la ruta absoluta) en vez de un «Error interno» genérico.
 */
export class CamerasConfigCorruptError extends CorruptJsonStoreError {
  readonly statusCode = 500;
  readonly code = 'CAMERAS_CONFIG_CORRUPT';

  constructor(path: string, cause?: unknown) {
    super(path, cause);
    this.name = 'CamerasConfigCorruptError';
    this.message =
      'El fichero de cámaras está dañado. Restáuralo desde una copia de seguridad o revísalo a mano; no se ha modificado.';
  }
}

/** Traduce el error genérico del store al de cámaras, para que lo vea el cliente. */
function aCamaras(err: unknown): unknown {
  return err instanceof CorruptJsonStoreError && !(err instanceof CamerasConfigCorruptError)
    ? new CamerasConfigCorruptError(err.path, err)
    : err;
}

/** Envuelve el store de cámaras: un único punto de traducción, no un try/catch por ruta. */
export function withCamerasCorruptError<T extends Identifiable>(store: JsonStore<T>): JsonStore<T> {
  const wrap = async <R>(op: () => Promise<R>): Promise<R> => {
    try {
      return await op();
    } catch (err) {
      throw aCamaras(err);
    }
  };
  return {
    list: () => wrap(() => store.list()),
    get: (id) => wrap(() => store.get(id)),
    upsert: (item) => wrap(() => store.upsert(item)),
    removeById: (id) => wrap(() => store.removeById(id)),
  };
}
