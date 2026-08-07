import type { FastifyInstance } from 'fastify';
import { createTickLoop, type TickLoop } from '../../system/tick-loop.js';
import {
  DEFAULT_ENERGY_RETENTION_DAYS,
  pruneAuditLog,
  pruneAutomationRuns,
  pruneDnsQueryLog,
  pruneKnownDestinations,
  pruneEnergySamples,
  pruneExpiredRefreshTokens,
  pruneExpiredWebAuthnChallenges,
  prunePresenceEvents,
  pruneSurveyScans,
  retentionDays,
} from '../../config/retention.js';

/** Retención por defecto del registro de auditoría si el ajuste no existe. */
const DEFAULT_AUDIT_RETENTION_DAYS = 90;

/** Barrido periódico de retención por defecto: cada 6 h. */
const DEFAULT_SWEEP_MS = 6 * 60 * 60 * 1000;

/**
 * Servicio de retención (US-102): poda periódicamente el registro de auditoría
 * según `auditRetentionDays`, de modo que la tabla no crezca sin límite. Sigue el
 * mismo patrón de timer `unref()` que el muestreo de tráfico y el barrido de
 * inventario; no se arranca en los tests (sin timers).
 */
export class RetentionService {
  private loop: TickLoop | null = null;

  constructor(
    private readonly app: FastifyInstance,
    private readonly intervalMs = DEFAULT_SWEEP_MS,
  ) {}

  /** Ejecuta una poda, registrando el resultado. No propaga errores (fire-and-forget). */
  async pruneOnce(): Promise<void> {
    try {
      const days = await retentionDays(
        this.app.prisma,
        'auditRetentionDays',
        DEFAULT_AUDIT_RETENTION_DAYS,
      );
      const removed = await pruneAuditLog(this.app.prisma, days);
      if (removed > 0) {
        this.app.log.info(`[retention] podados ${removed} registros de auditoría (> ${days} días)`);
      }
      // Tablas de sesión/2FA que crecían sin límite (US-206 / AUD-11).
      const tokens = await pruneExpiredRefreshTokens(this.app.prisma);
      if (tokens > 0) {
        this.app.log.info(`[retention] podados ${tokens} refresh tokens expirados`);
      }
      const challenges = await pruneExpiredWebAuthnChallenges(this.app.prisma);
      if (challenges > 0) {
        this.app.log.info(`[retention] podados ${challenges} desafíos WebAuthn expirados`);
      }
      const runs = await pruneAutomationRuns(this.app.prisma);
      if (runs > 0) {
        this.app.log.info(`[retention] podadas ${runs} ejecuciones de automatizaciones`);
      }
      const presence = await prunePresenceEvents(this.app.prisma);
      if (presence > 0) {
        this.app.log.info(`[retention] podadas ${presence} llegadas/salidas de presencia`);
      }
      // Red de seguridad de los rollups de energía (US-181): el flush por minuto
      // ya poda, pero si el sampler estuvo parado, esto los recorta igualmente.
      const energyDays = await retentionDays(
        this.app.prisma,
        'energyRetentionDays',
        DEFAULT_ENERGY_RETENTION_DAYS,
      );
      const energy = await pruneEnergySamples(this.app.prisma, energyDays);
      if (energy > 0) {
        this.app.log.info(`[retention] podados ${energy} rollups de energía (> ${energyDays} días)`);
      }
      // Recorridos de cobertura antiguos (US-228): nada los podaba y cada uno son
      // hasta 10.000 muestras. Las muestras caen en cascada con su recorrido.
      const scans = await pruneSurveyScans(this.app.prisma);
      if (scans > 0) {
        this.app.log.info(`[retention] podados ${scans} recorridos de cobertura antiguos`);
      }
      // Histórico DNS (US-252): la tabla más sensible del sistema. La ingesta ya
      // poda en su propio barrido; esto es la red de seguridad para cuando la
      // ingesta esté parada y el historial viejo se quede en disco.
      const dns = await pruneDnsQueryLog(this.app.prisma);
      if (dns > 0) {
        this.app.log.info(`[retention] podadas ${dns} consultas DNS del histórico`);
      }
      // Destinos conocidos (US-253): memoria larga y declarada, pero no eterna.
      // Se mide desde la última visita, así que solo cae lo que el aparato dejó
      // de visitar hace meses.
      const destinos = await pruneKnownDestinations(this.app.prisma);
      if (destinos > 0) {
        this.app.log.info(`[retention] olvidados ${destinos} destinos que ya no se visitan`);
      }
    } catch (err) {
      this.app.log.error({ err }, '[retention] la poda de auditoría falló');
    }
  }

  start(): void {
    if (this.loop) return;
    this.loop = createTickLoop({
      intervalMs: this.intervalMs,
      immediate: true,
      // `pruneOnce` ya no propaga errores; el guard evita solapar dos podas
      // largas (la de tráfico recorre la tabla mayor).
      tick: () => this.pruneOnce(),
      onSkip: () =>
        this.app.log.warn('[retention] la poda anterior sigue en curso; se salta este ciclo'),
    });
    this.loop.start();
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
  }
}
