import { api } from '@/lib/api';

/** ¿El navegador soporta service workers + Web Push? */
export function isPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window;
}

/** Clave pública VAPID del agente (para suscribirse). */
export async function getVapidPublicKey(): Promise<string> {
  const { publicKey } = await api.get<{ publicKey: string }>('/push/vapid-public-key');
  return publicKey;
}

/** Convierte la clave pública VAPID (base64url) al `Uint8Array` que espera el navegador. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Pide permiso y suscribe el endpoint en el agente.
 *
 * El service worker **ya se registra en el arranque** (`lib/pwa.ts`, US-234), así
 * que aquí solo se espera a que esté listo. Antes este era el único sitio donde
 * se registraba, y de ahí venía que la PWA solo existiese para quien activaba las
 * notificaciones; se mantiene el `register()` como red de seguridad idempotente
 * por si el arranque no pudo (el navegador devuelve el registro existente).
 */
export async function subscribeToPush(): Promise<void> {
  const registration = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permiso de notificaciones denegado');

  const publicKey = await getVapidPublicKey();
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  const json = subscription.toJSON();
  await api.post('/push/subscribe', {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth },
  });
}

/** Cancela la suscripción local y la elimina en el agente. */
export async function unsubscribeFromPush(): Promise<void> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await api.del('/push/subscribe', { body: { endpoint: subscription.endpoint } });
  await subscription.unsubscribe();
}
