import type { FastifyInstance } from 'fastify';
import { pushNotificationForAudit } from '../modules/push/push.service.js';

/**
 * Alertas por email (US-110). Envía un correo ante los mismos eventos de auditoría
 * de alta prioridad que ya disparan la notificación push (login fallido, cuenta
 * bloqueada, reuso de refresh, dispositivo bloqueado, MAC desconocida). Mock-first:
 * el transporte es inyectable (tests) y el real usa `nodemailer` con **import
 * perezoso** (dep opcional, no está en `package.json`). Si no hay SMTP configurado,
 * el mailer queda deshabilitado y `notifyForAudit` no hace nada.
 */

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  from: string;
  to: string;
}

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export type SendMail = (msg: MailMessage) => Promise<void>;

/** Lee la config SMTP de las variables de entorno, o `null` si no está configurada. */
export function smtpConfigFromEnv(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const to = process.env.ALERT_EMAIL_TO;
  if (!host || !to) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER || undefined,
    pass: process.env.SMTP_PASS || undefined,
    from: process.env.SMTP_FROM || 'krakenos@localhost',
    to,
  };
}

/** Transporte real vía nodemailer (import perezoso; se instala en el servidor). */
function realTransport(config: SmtpConfig): SendMail {
  return async (msg) => {
    const moduleName = 'nodemailer';
    const mod = (await import(moduleName).catch(() => {
      throw new Error('Instala `nodemailer` en el servidor para las alertas por email');
    })) as {
      createTransport: (opts: unknown) => { sendMail: (m: MailMessage) => Promise<unknown> };
    };
    const transport = mod.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      ...(config.user ? { auth: { user: config.user, pass: config.pass } } : {}),
    });
    await transport.sendMail(msg);
  };
}

export class Mailer {
  private readonly send: SendMail | null;

  constructor(
    private readonly app: Pick<FastifyInstance, 'log' | 'alertConfig'>,
    private readonly config: SmtpConfig | null,
    transport?: SendMail,
  ) {
    this.send = config ? (transport ?? realTransport(config)) : (transport ?? null);
  }

  get enabled(): boolean {
    return this.config != null && this.send != null;
  }

  /** Envía una alerta por email a partir de una acción de auditoría (fire-and-forget). */
  notifyForAudit(action: string, detail?: string | null, ip?: string | null): void {
    if (!this.config || !this.send) return;
    const note = pushNotificationForAudit(action, detail, ip);
    if (!note) return;
    // Regla de alerta configurable (US-112): si no hay config (tests), ON.
    const channels = this.app.alertConfig?.channelsFor(action) ?? { push: true, email: true };
    if (!channels.email) return;
    const msg: MailMessage = {
      from: this.config.from,
      to: this.config.to,
      subject: `[KrakenOS] ${note.title}`,
      text: `${note.body}\n\n— KrakenOS`,
    };
    void this.send(msg).catch((err: unknown) =>
      this.app.log.warn({ err }, 'No se pudo enviar la alerta por email'),
    );
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Alertas por email (decorado en `server.ts` si hay SMTP configurado). */
    mailer?: Mailer;
  }
}
