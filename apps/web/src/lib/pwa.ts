/**
 * Registro del service worker (US-234 / AUD3-24).
 *
 * Antes el único `register()` vivía dentro de `subscribeToPush()`: quien no
 * activaba notificaciones **no tenía service worker**, así que «instálala como
 * app» daba una ventana sin barra de direcciones que, sin red, mostraba el error
 * del navegador y no había forma de recargar. Ahora se registra en el arranque,
 * independientemente de las notificaciones.
 *
 * El registro es **best-effort y silencioso**: un SW que no arranca degrada la
 * app a una web normal, que es exactamente lo que había antes. Nunca debe
 * impedir que la app cargue.
 */

/** ¿Este navegador puede tener service worker? (jsdom y http no seguro: no). */
export function soportaServiceWorker(): boolean {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/**
 * Registra `/sw.js` si el entorno lo permite. Devuelve el registro, o `null` si
 * no se pudo (sin soporte, contexto no seguro, o el fichero no está).
 *
 * ⚠️ **Contexto seguro obligatorio.** Los service workers solo existen bajo
 * HTTPS o `localhost`. La instalación por defecto sirve **HTTP plano**
 * (`HTTPS_ENABLED=false` en el `.env` que genera el instalador), así que en una
 * IP de LAN esto devuelve `null` y no hay PWA, ni Web Push, ni passkeys. Esa
 * mitad del problema es de despliegue, no de este fichero.
 */
export async function registrarServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!soportaServiceWorker()) return null;
  if (typeof window !== 'undefined' && !window.isSecureContext) return null;
  if (!esCompilacionDeProduccion()) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

/**
 * ¿Estamos en una compilación de producción? En `pnpm dev` no se registra el SW.
 *
 * ⚠️ Esto no es una optimización: era un fallo de flujo. `localhost` es contexto
 * seguro, así que en desarrollo el SW se registraba igual que en producción y se
 * ponía por delante de los módulos que sirve Vite. Como sus URL no llevan hash
 * (`/src/App.tsx`, `/@vite/client`), la app quedaba clavada en la versión que se
 * cacheó primero: al recargar no aparecía el último cambio, el HMR parecía
 * funcionar «a veces» y no había ningún error en pantalla que lo explicara. El
 * único arreglo estable es que en desarrollo el service worker no exista.
 *
 * La PWA es para quien **usa** la app instalada, no para quien la desarrolla:
 * `pnpm prod` y la imagen Docker sirven un build de producción, así que ahí sigue
 * registrándose igual que antes.
 */
function esCompilacionDeProduccion(): boolean {
  // `import.meta.env` lo inyecta Vite; en Vitest (jsdom) `PROD` es false, que es
  // lo correcto: los tests no deben registrar un service worker de verdad.
  return import.meta.env.PROD;
}
