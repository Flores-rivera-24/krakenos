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
/** Envío de una foto (bytes + mime) con pie de foto. Inyectable (tests). */
export type SendTelegramPhoto = (caption: string, photo: Uint8Array, mime: string) => Promise<void>;

/** Lee la config del bot desde el entorno, o `null` si no está configurado. */
export function telegramConfigFromEnv(): TelegramConfig | null {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

/** Redacta el token del bot de cualquier texto de error (podría acabar en el log). */
function redactToken(message: string): string {
  return message.replace(/bot[^/\s"']+/gi, 'bot***');
}

/**
 * Enmascara identificadores que no deben salir del perímetro en claro (postura
 * de PII de US-85): la Bot API es nube de un tercero, así que las MACs se
 * reducen a sus últimos octetos y las IPs a «la red local».
 */
export function maskSensitive(text: string): string {
  return text
    .replace(/\b(?:[0-9a-f]{2}:){4}([0-9a-f]{2}:[0-9a-f]{2})\b/gi, '…:$1')
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, 'la red local');
}

/** Envío real contra la Bot API (por `safeFetch`: valida URL y cada redirect). */
function realSender(config: TelegramConfig): SendTelegram {
  return async (text) => {
    try {
      const res = await safeFetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: config.chatId, text }),
      });
      if (!res.ok) throw new Error(`Telegram respondió ${res.status}`);
    } catch (err) {
      // Un error de egress puede llevar la URL completa (token incluido): se
      // relanza redactado para que jamás acabe en el log.
      throw new Error(redactToken(err instanceof Error ? err.message : String(err)));
    }
  };
}

/** Envío real de foto vía `sendPhoto` (multipart) por `safeFetch`. */
function realPhotoSender(config: TelegramConfig): SendTelegramPhoto {
  return async (caption, photo, mime) => {
    try {
      const form = new FormData();
      form.append('chat_id', config.chatId);
      form.append('caption', caption);
      form.append('photo', new Blob([photo], { type: mime }), 'motion.jpg');
      const res = await safeFetch(`https://api.telegram.org/bot${config.botToken}/sendPhoto`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error(`Telegram respondió ${res.status}`);
    } catch (err) {
      throw new Error(redactToken(err instanceof Error ? err.message : String(err)));
    }
  };
}

/**
 * Decodifica una data URL de imagen a `{ bytes, mime }`, o `null` si no es una
 * imagen **rasterizada** en base64 (Telegram no acepta SVG; el mock lo produce).
 */
export function decodeImageDataUrl(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:(image\/(?:jpeg|jpg|png|webp));base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  try {
    return { bytes: new Uint8Array(Buffer.from(m[2]!, 'base64')), mime: m[1]! };
  } catch {
    return null;
  }
}

export class TelegramNotifier {
  private readonly send: SendTelegram | null;
  private readonly sendPhoto: SendTelegramPhoto | null;

  constructor(
    private readonly app: FastifyInstance,
    config: TelegramConfig | null,
    send?: SendTelegram,
    sendPhoto?: SendTelegramPhoto,
  ) {
    this.send = send ?? (config ? realSender(config) : null);
    this.sendPhoto = sendPhoto ?? (config ? realPhotoSender(config) : null);
  }

  get enabled(): boolean {
    return this.send !== null;
  }

  /**
   * Envío genérico (resumen del hogar, avisos). Fire-and-forget con log. Todo
   * lo que sale hacia Telegram va con los identificadores enmascarados.
   */
  notify(title: string, body: string): void {
    if (!this.send) return;
    void this.send(maskSensitive(`${title}\n${body}`)).catch((err: unknown) =>
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

  /**
   * Envía una **foto** (data URL rasterizada) por Telegram para un evento
   * auditado, si el canal está activo para ese evento (US-186). Respeta la misma
   * regla de canal que el texto; una imagen no rasterizable (SVG del mock) se
   * ignora en silencio. Fire-and-forget con log.
   */
  sendPhotoForAudit(action: string, caption: string, imageDataUrl: string): void {
    if (!this.sendPhoto) return;
    const channels = this.app.alertConfig?.channelsFor(action) ?? { telegram: true };
    if (!channels.telegram) return;
    const decoded = decodeImageDataUrl(imageDataUrl);
    if (!decoded) return;
    void this.sendPhoto(maskSensitive(caption), decoded.bytes, decoded.mime).catch((err: unknown) =>
      this.app.log.warn({ err }, 'No se pudo enviar la foto por Telegram'),
    );
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Canal Telegram (US-180), decorado en `server.ts`. */
    telegram?: TelegramNotifier;
  }
}
