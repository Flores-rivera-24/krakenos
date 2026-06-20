// `web-push` es CommonJS: import por defecto (los named imports rompen en ESM en
// producción, donde el bundle corre como módulo ES y Node no resuelve los exports).
import webpush from 'web-push';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/**
 * Genera un par de claves VAPID (pública/privada) para Web Push (US-45). La
 * pública se entrega al cliente; la privada nunca sale del agente. Función pura:
 * delega en `web-push` y no toca disco ni base de datos.
 */
export function generateVapidKeys(): VapidKeys {
  return webpush.generateVAPIDKeys();
}
