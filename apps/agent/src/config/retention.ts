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
type PrismaLike = Pick<
  PrismaClient,
  'setting' | 'auditLog' | 'refreshToken' | 'webAuthnChallenge' | 'automationRun' | 'presenceEvent'
>;

/** Retención fija del log de ejecuciones de automatizaciones (US-167). */
export const AUTOMATION_RUN_RETENTION_DAYS = 30;

/** Retención fija del timeline de llegadas/salidas (US-169): dato sensible, corto. */
export const PRESENCE_EVENT_RETENTION_DAYS = 30;

/**
 * Margen (días tras `expiresAt`) durante el que se conservan los refresh tokens
 * muertos: la detección de reuso (US-78) necesita encontrar el token rotado si
 * alguien lo re-presenta poco después. Pasado el margen, un token expirado ya no
 * autentica ni aporta señal — solo engorda la tabla que consulta cada
 * `/auth/refresh` (AUD-11 / US-206).
 */
export const REFRESH_PRUNE_MARGIN_DAYS = 7;

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

/**
 * Borra los refresh tokens expirados hace más de `marginDays` (US-206 / AUD-11).
 * El margen conserva la ventana de detección de reuso (US-78).
 */
export async function pruneExpiredRefreshTokens(
  prisma: PrismaLike,
  marginDays: number = REFRESH_PRUNE_MARGIN_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - marginDays * DAY_MS);
  const res = await prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
  return res.count;
}

/**
 * Borra los desafíos WebAuthn expirados (US-206 / AUD-11). Antes solo se
 * purgaban si ese mismo usuario reintentaba una ceremonia.
 */
export async function pruneExpiredWebAuthnChallenges(prisma: PrismaLike): Promise<number> {
  const res = await prisma.webAuthnChallenge.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return res.count;
}

/** Borra las ejecuciones de automatizaciones más antiguas que la retención (US-167). */
export async function pruneAutomationRuns(
  prisma: PrismaLike,
  days: number = AUTOMATION_RUN_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - days * DAY_MS);
  const res = await prisma.automationRun.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return res.count;
}

/** Borra las llegadas/salidas del timeline más antiguas que la retención (US-169). */
export async function prunePresenceEvents(
  prisma: PrismaLike,
  days: number = PRESENCE_EVENT_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - days * DAY_MS);
  const res = await prisma.presenceEvent.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return res.count;
}
