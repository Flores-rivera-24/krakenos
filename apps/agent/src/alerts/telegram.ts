import type { FastifyInstance } from 'fastify';
import { safeFetch } from '../net/egress.js';
import { pushNotificationForAudit } from '../modules/push/push.service.js';

/**
 * Canal Telegram (US-180). **Opt-in por variables de entorno**: sin
 * `TELEGRAM_BOT_TOKEN`+`TELEGRAM_CHAT_ID` no existe el canal ni sale ninguna
 * petición. El envío real va por `safeFetch` (política de egress, US-180 exige
 * egress-filtering en todo lo saliente); el sender es inyectable (tests,
 * mock-first como el mailer).
 */

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export type SendTelegram = (text: string) => Promise<void>;

/** Lee la config del bot desde el entorno, o `null` si no está configurado. */
export function telegramConfigFromEnv(): TelegramConfig | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

/** Envío real contra la Bot API (por `safeFetch`: valida URL y cada redirect). */
function realSender(config: TelegramConfig): SendTelegram {
  return async (text) => {
    const res = await safeFetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text }),
    });
    if (!res.ok) throw new Error(`Telegram respondió ${res.status}`);
  };
}

export class TelegramNotifier {
  private readonly send: SendTelegram | null;

  constructor(
    private readonly app: FastifyInstance,
    config: TelegramConfig | null,
    send?: SendTelegram,
  ) {
    this.send = send ?? (config ? realSender(config) : null);
  }

  get enabled(): boolean {
    return this.send !== null;
  }

  /** Envío genérico (resumen del hogar, avisos). Fire-and-forget con log. */
  notify(title: string, body: string): void {
    if (!this.send) return;
    void this.send(`${title}\n${body}`).catch((err: unknown) =>
      this.app.log.warn({ err }, 'No se pudo enviar la alerta por Telegram'),
    );
  }

  /** Alerta ante un evento auditado, según la regla del evento (patrón US-112). */
  notifyForAudit(action: string, detail?: string | null, ip?: string | null): void {
    if (!this.send) return;
    const note = pushNotificationForAudit(action, detail, ip);
    if (!note) return;
    // Regla de alerta configurable (US-112): si no hay config (tests), ON.
    const channels = this.app.alertConfig?.channelsFor(action) ?? { telegram: true };
    if (!channels.telegram) return;
    this.notify(`⚠️ ${note.title}`, note.body);
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Canal Telegram (US-180), decorado en `server.ts`. */
    telegram?: TelegramNotifier;
  }
}
