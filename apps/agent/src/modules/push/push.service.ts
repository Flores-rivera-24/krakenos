import type { FastifyInstance } from 'fastify';
// `web-push` es CommonJS: import por defecto (los named imports rompen en ESM en
// producción, donde el bundle corre como módulo ES).
import webpush from 'web-push';
import { generateVapidKeys, type VapidKeys } from '../../push/vapid.js';

const VAPID_PUBLIC_KEY = 'vapid.publicKey';
const VAPID_PRIVATE_KEY = 'vapid.privateKey';
/** Sujeto VAPID (mailto/URL de contacto): requerido por el protocolo Web Push. */
const VAPID_SUBJECT = 'mailto:admin@krakenos.local';

/** Acciones de auditoría que disparan una notificación push (US-45). */
export const HIGH_PRIORITY_AUDIT_ACTIONS = [
  'auth.login_failed',
  'auth.login_locked',
  'device.block',
  'inventory.unknown_device',
] as const;

/**
 * Mapea una acción de auditoría de alta prioridad a su notificación, o `null`
 * si no debe notificarse. Función pura (testeable sin servicio).
 */
export function pushNotificationForAudit(
  action: string,
  detail?: string | null,
  ip?: string | null,
): { title: string; body: string; url: string } | null {
  switch (action) {
    case 'auth.login_failed':
      return { title: 'Login fallido', body: `Intento desde ${ip ?? 'IP desconocida'}`, url: '/settings' };
    case 'auth.login_locked':
      return { title: 'Cuenta bloqueada', body: 'Demasiados intentos de login fallidos', url: '/settings' };
    case 'device.block':
      return { title: 'Dispositivo bloqueado', body: detail ?? 'Un dispositivo fue bloqueado', url: '/inventory' };
    case 'inventory.unknown_device':
      return { title: 'Dispositivo desconocido', body: 'Nueva MAC en la red', url: '/inventory' };
    default:
      return null;
  }
}

interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Envía notificaciones Web Push a los usuarios suscritos (US-45). Las claves
 * VAPID se persisten en `Setting` y se generan al vuelo si aún no existen. Si un
 * endpoint responde 410 (Gone), se elimina la suscripción automáticamente.
 */
export class PushService {
  constructor(private readonly app: FastifyInstance) {}

  /** Lee las claves VAPID de `Setting`; las genera y persiste si no existen. */
  async ensureKeys(): Promise<VapidKeys> {
    const rows = await this.app.prisma.setting.findMany({
      where: { key: { in: [VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY] } },
    });
    const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    let publicKey = stored[VAPID_PUBLIC_KEY];
    let privateKey = stored[VAPID_PRIVATE_KEY];

    if (!publicKey || !privateKey) {
      const keys = generateVapidKeys();
      publicKey = keys.publicKey;
      privateKey = keys.privateKey;
      await this.app.prisma.setting.upsert({
        where: { key: VAPID_PUBLIC_KEY },
        create: { key: VAPID_PUBLIC_KEY, value: publicKey },
        update: { value: publicKey },
      });
      await this.app.prisma.setting.upsert({
        where: { key: VAPID_PRIVATE_KEY },
        create: { key: VAPID_PRIVATE_KEY, value: privateKey },
        update: { value: privateKey },
      });
    }
    return { publicKey, privateKey };
  }

  /** Clave pública VAPID (se envía al cliente para suscribirse). */
  async getPublicKey(): Promise<string> {
    return (await this.ensureKeys()).publicKey;
  }

  /** Envía una notificación a todas las suscripciones de un usuario. */
  async sendToUser(userId: string, title: string, body: string, url = '/'): Promise<void> {
    const subs = (await this.app.prisma.pushSubscription.findMany({
      where: { userId },
    })) as SubscriptionRow[];
    await this.deliver(subs, title, body, url);
  }

  /** Envía una notificación a todos los usuarios con suscripción activa. */
  async sendToAll(title: string, body: string, url = '/'): Promise<void> {
    const subs = (await this.app.prisma.pushSubscription.findMany()) as SubscriptionRow[];
    await this.deliver(subs, title, body, url);
  }

  /** Dispara una notificación a partir de una acción de auditoría (fire-and-forget). */
  notifyForAudit(action: string, detail?: string | null, ip?: string | null): void {
    const note = pushNotificationForAudit(action, detail, ip);
    if (!note) return;
    void this.sendToAll(note.title, note.body, note.url).catch((err: unknown) =>
      this.app.log.warn({ err }, 'No se pudo notificar el evento de auditoría'),
    );
  }

  private async deliver(
    subs: SubscriptionRow[],
    title: string,
    body: string,
    url: string,
  ): Promise<void> {
    if (subs.length === 0) return;
    const { publicKey, privateKey } = await this.ensureKeys();
    webpush.setVapidDetails(VAPID_SUBJECT, publicKey, privateKey);
    const payload = JSON.stringify({ title, body, url });

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
        );
      } catch (err) {
        // 410 Gone: el endpoint ya no es válido → eliminar la suscripción.
        if ((err as { statusCode?: number }).statusCode === 410) {
          await this.app.prisma.pushSubscription
            .delete({ where: { endpoint: sub.endpoint } })
            .catch(() => undefined);
        } else {
          this.app.log.warn({ err }, 'No se pudo enviar la notificación push');
        }
      }
    }
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Servicio de notificaciones push (decorado en `server.ts`/tests). */
    push?: PushService;
  }
}
