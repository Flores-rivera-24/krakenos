/**
 * Tipos transversales compartidos entre el agente y el frontend.
 */

/** Timestamp en formato ISO 8601 (UTC). */
export type IsoDateTime = string;

/** Identificador opaco (cuid/uuid) generado por el agente. */
export type Id = string;

/** Forma estándar de error devuelta por la API del agente. */
export interface ApiError {
  /** Código estable legible por máquina, p. ej. `AUTH_INVALID_CREDENTIALS`. */
  code: string;
  /** Mensaje legible por humanos. */
  message: string;
  /** Detalles opcionales (errores de validación campo a campo, etc.). */
  details?: Record<string, unknown>;
}

/** Envoltura de respuesta paginada. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Parámetros de paginación de query. */
export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

/** Resultado discriminado para operaciones que pueden fallar de forma controlada. */
export type Result<T, E = ApiError> =
  | { ok: true; value: T }
  | { ok: false; error: E };
