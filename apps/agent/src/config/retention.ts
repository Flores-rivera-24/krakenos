import type { PrismaClient } from '@prisma/client';
import { SETTING_BOUNDS, clampToBound } from './settings-bounds.js';

/**
 * Retención de datos (US-102): resuelve los ajustes `trafficRetentionDays` /
 * `auditRetentionDays` (antes eran ajustes muertos — existían pero nadie los leía)
 * y poda el registro de auditoría (que crecía sin límite). Las cotas viven en
 * `settings-bounds.ts`; un valor fuera de rango o ausente cae al `fallback`.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

type RetentionKey = 'trafficRetentionDays' | 'auditRetentionDays';

/** Prisma mínimo que necesitan estas funciones (facilita el tipado en llamantes). */
type PrismaLike = Pick<PrismaClient, 'setting' | 'auditLog'>;

/** Lee un ajuste de retención en días, acotado a su rango, con `fallback` si falta. */
export async function retentionDays(
  prisma: PrismaLike,
  key: RetentionKey,
  fallback: number,
): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key } });
  const n = row ? Number(row.value) : fallback;
  return clampToBound(n, SETTING_BOUNDS[key]) ?? fallback;
}

/** Borra los registros de auditoría más antiguos que `days`. Devuelve cuántos borró. */
export async function pruneAuditLog(prisma: PrismaLike, days: number): Promise<number> {
  const cutoff = new Date(Date.now() - days * DAY_MS);
  const res = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return res.count;
}
