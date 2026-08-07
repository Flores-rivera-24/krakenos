import type { UserRole } from '@krakenos/types';
import type { FastifyInstance } from 'fastify';
// `web-push` es CommonJS: import por defecto (los named imports rompen en ESM en
// producción, donde el bundle corre como módulo ES).
import webpush from 'web-push';
import { assertPushEndpointAllowed } from '../../push/endpoint.js';
import { generateVapidKeys, type VapidKeys } from '../../push/vapid.js';

const VAPID_PUBLIC_KEY = 'vapid.publicKey';
const VAPID_PRIVATE_KEY = 'vapid.privateKey';
/** Sujeto VAPID (mailto/URL de contacto): requerido por el protocolo Web Push. */
const VAPID_SUBJECT = 'mailto:admin@krakenos.local';
/** Entregas simultáneas: un endpoint lento no debe frenar a los demás (AUD3-01). */
const PUSH_CONCURRENCY = 6;
/** Timeout de socket por envío. `web-push` SOLO lo aplica si se le pasa (AUD3-01). */
const PUSH_TIMEOUT_MS = 8_000;

/** Acciones de auditoría que disparan una notificación push (US-45). */
export const HIGH_PRIORITY_AUDIT_ACTIONS = [
  'auth.login_failed',
  'auth.login_locked',
  'auth.refresh_reuse',
  'device.block',
  'inventory.unknown_device',
] as const;

/**
 * A quién va dirigida una notificación derivada de una acción auditada (AUD3-01).
 * `admin` = seguridad/red (solo quien administra) · `home` = eventos de la casa,
 * que también recibe `member` (puede armar y desarmar la alarma).
 */
export type PushAudience = 'admin' | 'home';

/**
 * Roles que reciben cada audiencia. `kid`/`guest`/`viewer` **nunca** reciben avisos
 * derivados de auditoría: que vean el estado en la app es una cosa, y recibir en el
 * móvil «alarma disparada» o «login fallido desde 1.2.3.4» es otra.
 */
export const ROLES_BY_AUDIENCE: Record<PushAudience, readonly UserRole[]> = {
  admin: ['admin'],
  home: ['admin', 'member'],
};

/** Notificación lista para enviar, con su audiencia. */
export interface AuditNotification {
  title: string;
  body: string;
  url: string;
  audience: PushAudience;
}

/**
 * Mapea una acción de auditoría de alta prioridad a su notificación, o `null`
 * si no debe notificarse. Función pura (testeable sin servicio).
 */
export function pushNotificationForAudit(
  action: string,
  detail?: string | null,
  ip?: string | null,
): AuditNotification | null {
  switch (action) {
    case 'auth.login_failed':
      return { title: 'Login fallido', body: `Intento desde ${ip ?? 'IP desconocida'}`, url: '/settings', audience: 'admin' };
    case 'auth.login_locked':
      return { title: 'Cuenta bloqueada', body: 'Demasiados intentos de login fallidos', url: '/settings', audience: 'admin' };
    case 'auth.refresh_reuse':
      return { title: 'Posible robo de sesión', body: 'Refresh token reutilizado; sesiones revocadas', url: '/settings', audience: 'admin' };
    case 'device.block':
      return { title: 'Dispositivo bloqueado', body: detail ?? 'Un dispositivo fue bloqueado', url: '/inventory', audience: 'admin' };
    case 'inventory.unknown_device':
      return { title: 'Dispositivo desconocido', body: 'Nueva MAC en la red', url: '/inventory', audience: 'admin' };
    // US-253. Audiencia `admin` y no `home`: el aviso nombra aparato y dominio, o
    // sea **actividad por aparato** — la misma que `home.activity` cerró a los
    // demás roles (US-250). Mandárselo a `member` por push reabriría por detrás
    // lo que la API cierra por delante.
    case 'dns.new_destination':
      return {
        title: 'Destino nuevo',
        body: detail ?? 'Un aparato ha contactado con un destino nuevo',
        url: '/dns',
        audience: 'admin',
      };
    case 'camera.motion':
      return {
        title: 'Movimiento detectado',
        body: detail ? `Movimiento en ${detail}` : 'Una cámara detectó movimiento',
        url: '/cameras',
        audience: 'home',
      };
    case 'alarm.triggered':
      return {
        title: '🚨 ¡Alarma disparada!',
        body: detail ? `Activada por ${detail}` : 'Se disparó la alarma del hogar',
        url: '/',
        audience: 'home',
      };
    // US-245: llegan con la alarma desarmada, así que el cuerpo no puede dar por
    // hecho que haya una alarma sonando ni mandar a desarmarla.
    case 'alarm.smoke':
      return {
        title: '🔥 ¡Humo detectado!',
        body: detail ?? 'Un detector de humo se ha activado',
        url: '/iot',
        audience: 'home',
      };
    case 'alarm.co':
      return {
        title: '☠️ ¡Monóxido de carbono!',
        body: detail ?? 'Un detector de CO se ha activado. Ventila y sal de casa.',
        url: '/iot',
        audience: 'home',
      };
    case 'alarm.sensor_fault':
      return {
        title: 'Sensor de alarma caído',
        body: detail ? `${detail} no responde estando armada` : 'Un sensor no responde',
        url: '/',
        audience: 'home',
      };
    // ⚠️ Estos dos estaban en el catálogo de alertas SIN contenido aquí (US-245).
    // Como esta función es la fuente de contenido de los **tres** canales —push,
    // email y Telegram la llaman antes de mirar `channelsFor`—, devolver `null`
    // no degradaba a «solo email»: no se enviaba nada por ningún canal. El usuario
    // veía sus conmutadores en Ajustes → Alertas, los activaba, y no llegaba nunca
    // un aviso. Lo ata ahora `test/unit/alert-content-coverage.test.ts`.
    case 'energy.threshold':
      return {
        title: 'Consumo eléctrico anómalo',
        body: detail ?? 'Un dispositivo cruzó su umbral de consumo',
        url: '/energy',
        audience: 'home',
      };
    case 'system.tls_expiring':
      return {
        title: 'El certificado HTTPS va a caducar',
        body: detail ?? 'Renueva el certificado o la app dejará de funcionar en el móvil',
        url: '/settings',
        audience: 'admin',
      };
    // Desarme fallido: alguien está probando PINes en la casa (AUD3-03). Antes se
    // auditaba en silencio, así que un ataque de fuerza bruta no avisaba a nadie.
    case 'alarm.disarm_denied':
      return {
        title: 'PIN de alarma incorrecto',
        body: detail ? `Intento de desarme de ${detail}` : 'Alguien intentó desarmar la alarma',
        url: '/',
        audience: 'home',
      };
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

  /**
   * Envía a **todas** las suscripciones, sin filtrar por rol. Reservado a los avisos
   * que el propio usuario ha pedido para la casa entera (acción «avisar» de una
   * automatización). Los avisos derivados de auditoría van por `sendToAudience`.
   */
  async sendToAll(title: string, body: string, url = '/'): Promise<void> {
    const subs = (await this.app.prisma.pushSubscription.findMany()) as SubscriptionRow[];
    await this.deliver(subs, title, body, url);
  }

  /**
   * Envía solo a los roles de la audiencia y a usuarios **activos** (AUD3-01). Un
   * invitado o un menor no recibe «alarma disparada» ni «login fallido»; un usuario
   * deshabilitado deja de recibir aunque su suscripción siga en la DB.
   */
  async sendToAudience(
    audience: PushAudience,
    title: string,
    body: string,
    url = '/',
  ): Promise<void> {
    const subs = (await this.app.prisma.pushSubscription.findMany({
      where: { user: { role: { in: [...ROLES_BY_AUDIENCE[audience]] }, status: 'active' } },
    })) as SubscriptionRow[];
    await this.deliver(subs, title, body, url);
  }

  /** Dispara una notificación a partir de una acción de auditoría (fire-and-forget). */
  notifyForAudit(action: string, detail?: string | null, ip?: string | null): void {
    const note = pushNotificationForAudit(action, detail, ip);
    if (!note) return;
    // Regla de alerta configurable (US-112): si no hay config (p. ej. en tests), ON.
    const channels = this.app.alertConfig?.channelsFor(action) ?? { push: true, email: true };
    if (!channels.push) return;
    void this.sendToAudience(note.audience, note.title, note.body, note.url).catch((err: unknown) =>
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

    // Entrega en paralelo acotada sobre una cola compartida: antes era un bucle
    // secuencial con `await` y sin timeout, así que un endpoint que aceptara la
    // conexión y no respondiera congelaba el canal de avisos entero (AUD3-01).
    const queue = [...subs];
    const workers = Array.from({ length: Math.min(PUSH_CONCURRENCY, queue.length) }, () =>
      this.drainQueue(queue, payload),
    );
    await Promise.allSettled(workers);
  }

  /** Consume la cola compartida hasta agotarla. */
  private async drainQueue(queue: SubscriptionRow[], payload: string): Promise<void> {
    for (let sub = queue.shift(); sub; sub = queue.shift()) {
      await this.deliverOne(sub, payload);
    }
  }

  private async deliverOne(sub: SubscriptionRow, payload: string): Promise<void> {
    // El endpoint lo eligió el cliente: se revalida antes de CADA envío, no solo al
    // suscribirse (una fila anterior a esta guarda seguiría siendo un destino).
    try {
      await assertPushEndpointAllowed(sub.endpoint);
    } catch (err) {
      this.app.log.warn(
        { err, endpoint: sub.endpoint },
        'Suscripción push con endpoint no permitido: se elimina',
      );
      await this.removeSubscription(sub.endpoint);
      return;
    }

    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { timeout: PUSH_TIMEOUT_MS },
      );
    } catch (err) {
      // 410 Gone: el endpoint ya no es válido → eliminar la suscripción.
      if ((err as { statusCode?: number }).statusCode === 410) {
        await this.removeSubscription(sub.endpoint);
      } else {
        this.app.log.warn({ err }, 'No se pudo enviar la notificación push');
      }
    }
  }

  private async removeSubscription(endpoint: string): Promise<void> {
    await this.app.prisma.pushSubscription
      .deleteMany({ where: { endpoint } })
      .catch(() => undefined);
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Servicio de notificaciones push (decorado en `server.ts`/tests). */
    push?: PushService;
  }
}
