/**
 * Suscripción Web Push enviada por el navegador al agente (US-45). Coincide con
 * el resultado de `PushSubscription.toJSON()` (sin `expirationTime`).
 */
export interface PushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}
