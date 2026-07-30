import { readFile } from 'node:fs/promises';
import type { TlsStatus } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
import { createTickLoop, type TickLoop } from '../../system/tick-loop.js';
import {
  TLS_WARN_DAYS,
  certificateHealth,
  classifyCertificateSource,
  disabledWithoutTls,
  readCertificateValidity,
} from '../../system/tls.js';

/**
 * Vigilancia del certificado TLS (US-241).
 *
 * Hace **dos** cosas que hasta ahora no hacía nadie:
 *
 * 1. **Recarga en caliente el certificado renovado.** El cert se leía una vez en
 *    `config/env.ts` y se quedaba en memoria para siempre. Un certificado de
 *    Tailscale dura **90 días**, así que la instalación se rompía sola tres meses
 *    después de montarla: el fichero del disco ya estaba renovado y el proceso
 *    seguía presentando el viejo. Ahora se relee y se aplica con
 *    `setSecureContext()`, sin reiniciar y sin cortar las conexiones vivas.
 * 2. **Avisa antes de que caduque**, por el catálogo de alertas que ya existe
 *    (`system.tls_expiring` → push/email/Telegram según `AlertRule`). Enterarse
 *    cuando el móvil deja de conectar es enterarse tarde.
 *
 * El barrido es **horario**: el fichero cambia como mucho cada 90 días, así que
 * mirar más a menudo es I/O en una microSD a cambio de nada (US-228).
 */
const CHECK_INTERVAL_MS = 60 * 60_000;

/** Cada cuánto se repite el aviso de caducidad, para no spamear cada hora. */
const ALERT_COOLDOWN_MS = 24 * 60 * 60_000;

export interface TlsServiceOptions {
  /** Ruta del certificado en PEM; `null` si el agente no termina TLS. */
  certPath: string | null;
  keyPath: string | null;
  /** ¿Hay un proxy de confianza delante que ya termina TLS? */
  behindProxy: boolean;
  /** Reloj inyectable (tests). */
  now?: () => Date;
}

/** Servidor con recarga de contexto TLS (lo implementa `tls.Server` de Node). */
interface SecureContextServer {
  setSecureContext(context: { key: string; cert: string }): void;
}

function supportsHotReload(server: unknown): server is SecureContextServer {
  return typeof (server as SecureContextServer)?.setSecureContext === 'function';
}

export class TlsService {
  private loop: TickLoop | null = null;
  private readonly now: () => Date;
  /** Último PEM aplicado, para no re-aplicar contexto en cada barrido. */
  private appliedCert: string | null = null;
  private status: TlsStatus;
  private lastAlertAt = 0;

  constructor(
    private readonly app: FastifyInstance,
    private readonly opts: TlsServiceOptions,
  ) {
    this.now = opts.now ?? (() => new Date());
    const secureContext = opts.certPath !== null || opts.behindProxy;
    this.status = {
      enabled: opts.certPath !== null,
      behindProxy: opts.behindProxy,
      source: null,
      notAfter: null,
      daysLeft: null,
      expiring: false,
      expired: false,
      disabledFeatures: disabledWithoutTls(secureContext),
    };
  }

  getStatus(): TlsStatus {
    return this.status;
  }

  /**
   * Relee el certificado del disco: actualiza el estado y, si el fichero cambió,
   * aplica el contexto nuevo al servidor vivo.
   */
  async check(): Promise<TlsStatus> {
    const { certPath, keyPath } = this.opts;
    if (!certPath || !keyPath) return this.status;

    let pem: string;
    let key: string;
    try {
      [pem, key] = await Promise.all([readFile(certPath, 'utf8'), readFile(keyPath, 'utf8')]);
    } catch (err) {
      // El servidor sigue sirviendo con lo que ya tenía cargado: un fichero
      // ilegible ahora mismo no es motivo para tocar nada ni para mentir en el
      // estado, así que se conserva el último conocido y se registra.
      this.app.log.warn({ err, certPath }, '[tls] no se pudo leer el certificado; se conserva el anterior');
      return this.status;
    }

    const validity = readCertificateValidity(pem);
    if (!validity) {
      this.app.log.warn({ certPath }, '[tls] el certificado no se pudo parsear; estado sin cambios');
      return this.status;
    }

    const health = certificateHealth(validity.notAfter, this.now());
    this.status = {
      ...this.status,
      source: classifyCertificateSource(validity),
      notAfter: validity.notAfter.toISOString(),
      daysLeft: health.daysLeft,
      expiring: health.expiring,
      expired: health.expired,
    };

    // Recarga en caliente solo si el fichero cambió de verdad.
    if (pem !== this.appliedCert) {
      const primeraVez = this.appliedCert === null;
      this.appliedCert = pem;
      if (!primeraVez) {
        if (supportsHotReload(this.app.server)) {
          try {
            this.app.server.setSecureContext({ key, cert: pem });
            this.app.log.info(
              { notAfter: this.status.notAfter },
              '[tls] certificado renovado aplicado en caliente (sin reinicio)',
            );
            this.app.audit({ action: 'system.tls_reloaded', detail: this.status.notAfter ?? '' });
          } catch (err) {
            this.app.log.error({ err }, '[tls] no se pudo aplicar el certificado renovado');
          }
        } else {
          // HTTP puro o servidor sin soporte: se dice, en vez de fingir que se aplicó.
          this.app.log.warn('[tls] hay un certificado nuevo pero este servidor no admite recarga en caliente; reinicia el agente');
        }
      }
    }

    this.maybeAlert();
    return this.status;
  }

  /**
   * Avisa por el catálogo de alertas (US-112) cuando entra en la ventana. Con
   * cooldown diario: el barrido es horario y un aviso cada hora durante tres
   * semanas es ruido que se acaba silenciando — y entonces no avisa nadie.
   */
  private maybeAlert(): void {
    if (!this.status.expiring) return;
    const nowMs = this.now().getTime();
    if (nowMs - this.lastAlertAt < ALERT_COOLDOWN_MS) return;
    this.lastAlertAt = nowMs;

    const dias = this.status.daysLeft ?? 0;
    this.app.log.warn({ daysLeft: dias }, '[tls] el certificado está a punto de caducar');
    this.app.audit({
      action: 'system.tls_expiring',
      detail: this.status.expired
        ? 'El certificado HTTPS ha caducado'
        : `El certificado HTTPS caduca en ${dias} día(s)`,
    });
  }

  /** Arranca el barrido horario. Sin TLS propio no hay nada que vigilar. */
  start(intervalMs = CHECK_INTERVAL_MS): void {
    if (this.loop || !this.opts.certPath) return;
    void this.check().catch((err: unknown) => {
      this.app.log.error({ err }, '[tls] la comprobación inicial del certificado falló');
    });
    this.loop = createTickLoop({
      intervalMs,
      tick: () => this.check().then(() => undefined),
      onError: (err) => this.app.log.error({ err }, '[tls] el barrido del certificado falló'),
    });
    this.loop.start();
  }

  stop(): void {
    this.loop?.stop();
    this.loop = null;
  }
}

export { TLS_WARN_DAYS };
