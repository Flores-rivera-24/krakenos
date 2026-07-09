import type { FastifyInstance } from 'fastify';
import {
  pruneAuditLog,
  pruneExpiredRefreshTokens,
  pruneExpiredWebAuthnChallenges,
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
  private timer: NodeJS.Timeout | null = null;

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
    } catch (err) {
      this.app.log.error({ err }, '[retention] la poda de auditoría falló');
    }
  }

  start(): void {
    if (this.timer) return;
    void this.pruneOnce();
    this.timer = setInterval(() => void this.pruneOnce(), this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
