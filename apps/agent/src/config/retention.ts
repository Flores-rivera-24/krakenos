import type { PrismaClient } from '@prisma/client';
import { SETTING_BOUNDS, clampToBound } from './settings-bounds.js';

/**
 * Retención de datos (US-102): resuelve los ajustes `trafficRetentionDays` /
 * `auditRetentionDays` (antes eran ajustes muertos — existían pero nadie los leía)
 * y poda el registro de auditoría (que crecía sin límite). Las cotas viven en
 * `settings-bounds.ts`; un valor fuera de rango o ausente cae al `fallback`.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;

type RetentionKey = 'trafficRetentionDays' | 'auditRetentionDays' | 'energyRetentionDays';

/** Prisma mínimo que necesitan estas funciones (facilita el tipado en llamantes). */
type PrismaLike = Pick<
  PrismaClient,
  | 'setting'
  | 'auditLog'
  | 'refreshToken'
  | 'webAuthnChallenge'
  | 'automationRun'
  | 'presenceEvent'
  | 'energySample'
  | 'surveyScan'
  | 'dnsQueryLog'
>;

/** Retención fija del log de ejecuciones de automatizaciones (US-167). */
export const AUTOMATION_RUN_RETENTION_DAYS = 30;

/** Retención fija del timeline de llegadas/salidas (US-169): dato sensible, corto. */
export const PRESENCE_EVENT_RETENTION_DAYS = 30;

/**
 * Retención del histórico DNS (`DnsQueryLog`, US-252). **La más corta del
 * sistema**, y a propósito: es el historial de navegación del hogar, o sea el
 * dato más sensible que escribe el producto. Es más corta incluso que la de
 * presencia (30 d) porque responde a una pregunta operativa —«¿con quién habla
 * este aparato?»— que se contesta con días, no con meses; conservar más sería
 * acumular riesgo sin comprar respuesta.
 *
 * Es fija y no un ajuste, igual que la de presencia: un desplegable que permita
 * subirla a un año convierte una decisión de diseño en un descuido de
 * configuración.
 */
export const DNS_QUERY_RETENTION_DAYS = 7;

/**
 * Retención del rollup **por dispositivo** (`DeviceTrafficSample`, US-46).
 *
 * Es deliberadamente más corta que la del hogar: el rango máximo que se puede
 * consultar per-device es `week` (`traffic.schemas.ts`, y `wellbeing` igual), así
 * que conservar los 30 días de la serie agregada dejaba el **77 % de la tabla más
 * grande del sistema** en filas que ninguna consulta puede alcanzar (AUD3-12). Es
 * además la tabla que más crece: 1 fila/min **por MAC**.
 */
export const DEVICE_TRAFFIC_RETENTION_DAYS = 7;

/**
 * Retención de las muestras de un recorrido de cobertura (`SurveySample`, US-157).
 * Un recorrido son hasta 10.000 muestras (~1,8 MB) y hasta ahora **no se podaban
 * nunca** salvo al borrar su plano (AUD3-14): el histórico de mediciones de hace un
 * año no dice nada útil sobre la casa de hoy.
 */
export const SURVEY_SAMPLE_RETENTION_DAYS = 180;

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

/** Retención por defecto de los rollups de energía (días) si el ajuste no existe (US-181). */
export const DEFAULT_ENERGY_RETENTION_DAYS = 90;

/**
 * Borra los rollups de energía más antiguos que `days` (US-181). Devuelve cuántos
 * borró. El rollup por minuto ya poda en cada flush; esto es la red de seguridad
 * del barrido de retención por si el sampler estuvo parado.
 */
export async function pruneEnergySamples(
  prisma: PrismaLike,
  days: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - days * DAY_MS);
  const res = await prisma.energySample.deleteMany({ where: { timestamp: { lt: cutoff } } });
  return res.count;
}

/**
 * Borra las consultas DNS más antiguas que la retención (US-252). Es la poda de
 * la tabla más sensible del sistema, así que corre en el barrido de retención
 * **además** de acotarse en la ingesta: si el barrido se para, la ingesta sola no
 * puede dejar el historial creciendo indefinidamente.
 */
export async function pruneDnsQueryLog(
  prisma: PrismaLike,
  days: number = DNS_QUERY_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - days * DAY_MS);
  const res = await prisma.dnsQueryLog.deleteMany({ where: { timestamp: { lt: cutoff } } });
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

/**
 * Poda los **recorridos** de cobertura antiguos (US-228/AUD3-14). Se borra el
 * `SurveyScan`, no sus muestras sueltas: las filas de `SurveySample` caen en
 * cascada y no queda un recorrido vacío en la lista. Hasta ahora nada los podaba
 * —solo se iban al borrar su plano—, y cada recorrido son hasta 10.000 muestras
 * (~1,8 MB) que además encarecen el heatmap interpolado.
 */
export async function pruneSurveyScans(
  prisma: PrismaLike,
  days: number = SURVEY_SAMPLE_RETENTION_DAYS,
): Promise<number> {
  const cutoff = new Date(Date.now() - days * DAY_MS);
  const res = await prisma.surveyScan.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return res.count;
}
