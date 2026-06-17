import type { Id, IsoDateTime } from './common.js';

/** Entrada del registro de auditoría. */
export interface AuditLogEntry {
  id: Id;
  /** Acción, p. ej. `auth.login`, `wifi.update`, `device.block`. */
  action: string;
  /** Usuario que la realizó, si aplica. */
  userId: string | null;
  /** Contexto adicional (texto o JSON). */
  detail: string | null;
  ip: string | null;
  createdAt: IsoDateTime;
}
