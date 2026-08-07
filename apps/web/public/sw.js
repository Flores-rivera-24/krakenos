/*
 * KrakenOS service worker.
 *
 *  · Web Push (US-45): notificaciones del hogar.
 *  · PWA de verdad (US-234 / AUD3-24): hasta ahora este fichero eran 17 líneas
 *    **sin handler `fetch`**, y el único `register()` vivía dentro de
 *    `subscribeToPush()`. Resultado: quien no activaba notificaciones no tenía SW,
 *    y quien lo activaba se instalaba una «app» que sin red abría el error del
 *    navegador **en una ventana sin barra de direcciones** — sin forma de
 *    recargar ni de entender qué pasaba.
 *
 * ## Estrategias, y por qué
 *
 *  · **Navegación** → red primero, caché después. Es lo que evita la pantalla
 *    blanca: con 18 chunks hasheados, servir un `index.html` viejo desde caché
 *    haría pedir chunks que ya no existen. Con red primero, estando en línea
 *    siempre manda el shell nuevo; sin red, el shell viejo y sus chunks viejos
 *    son coherentes entre sí porque conviven en la misma caché.
 *  · **Estáticos** (`/assets/**`) → caché primero. Su nombre lleva el hash: si
 *    cambia el contenido, cambia la URL, así que nunca se sirven obsoletos.
 *  · **`/api`, `/health`, Socket.io** → **solo red, jamás caché.** Desvío
 *    consciente del criterio original («network-first para /api»): son respuestas
 *    **autenticadas** en un panel con roles (admin/member/kid/guest) sobre un
 *    dispositivo posiblemente compartido. Una copia en disco sobreviviría al
 *    logout y podría acabar sirviéndose a la siguiente persona. Un dato de más en
 *    la caché es una fuga; uno de menos es solo un error en pantalla, que la app
 *    ya sabe mostrar (estado «No se pudo cargar · Reintentar» por widget).
 */
/* global self, caches, clients, Response */

// Subir esta versión invalida TODA la caché anterior (ver `activate`). Tocarla en
// cada release evita arrastrar chunks de versiones viejas indefinidamente.
const VERSION = 'kr-v1';
const CACHE = `krakenos-${VERSION}`;
const SHELL = '/index.html';

/** Rutas que NUNCA deben tocar la caché (datos autenticados o tiempo real). */
function esSoloRed(url) {
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/health') ||
    url.pathname.startsWith('/socket.io/')
  );
}

/**
 * ¿Es esta URL **inmutable**, o sea seguro servirla de caché sin revalidar?
 *
 * «Caché primero» solo es correcto cuando un cambio de contenido implica un
 * cambio de URL. Eso lo cumple `/assets/*` —Vite emite el hash del contenido en
 * el nombre— y nada más: el resto de estáticos (`/theme-init.js`,
 * `/locale-init.js`, los iconos) mantienen su URL entre versiones, así que van
 * por red primero y solo caen a la caché si no hay conexión.
 *
 * ⚠️ Antes esta distinción no existía: el handler cacheaba «primero caché»
 * cualquier GET del mismo origen. En producción casi colaba (casi todo es
 * `/assets/*`), pero se quedaba con `/theme-init.js` de la versión anterior; y
 * en `pnpm dev` era claramente dañino, porque allí el SW **también** se registra
 * (`localhost` es contexto seguro) y las URL de los módulos de Vite son
 * **estables**: `/src/App.tsx`, `/@vite/client`, `/node_modules/.vite/deps/*`.
 * El SW se quedaba con la primera versión de cada módulo y al recargar servía
 * código viejo —el cambio recién guardado no aparecía— sin ningún error que lo
 * explicara. Eso se cierra por dos sitios: aquí, y no registrando el SW en
 * desarrollo (`lib/pwa.ts`). Lo fija `e2e/stacks/specs/service-worker.spec.ts`.
 */
function esInmutable(url) {
  return url.pathname.startsWith('/assets/');
}

/** Página de cortesía cuando no hay red NI copia en caché. */
function paginaSinConexion() {
  const html = [
    '<!doctype html>',
    '<html lang="es"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
    '<title>KrakenOS &mdash; sin conexion</title>',
    '<style>',
    ':root{color-scheme:dark}',
    'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d1117;',
    'color:#e6edf3;font-family:Inter,system-ui,-apple-system,sans-serif;',
    'padding:max(1.5rem,env(safe-area-inset-top)) 1.5rem}',
    'main{max-width:26rem;text-align:center}',
    'h1{font-size:1.25rem;margin:0 0 .75rem}',
    'p{color:#8b949e;line-height:1.5;margin:0 0 1.5rem}',
    'a{display:inline-block;font:inherit;padding:.6rem 1.2rem;border-radius:.5rem;',
    'background:#2563eb;color:#fff;text-decoration:none}',
    '</style></head>',
    '<body><main>',
    '<h1>No llego a tu casa</h1>',
    '<p>KrakenOS solo responde desde tu red. Comprueba que est&aacute;s en tu WiFi o que el',
    ' t&uacute;nel (WireGuard o Tailscale) est&aacute; conectado. Int&eacute;ntalo de nuevo.</p>',
    '<a href="/">Reintentar</a>',
    '</main></body></html>',
  ].join('');
  return new Response(html, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

self.addEventListener('install', (e) => {
  // Cachea el shell de entrada; el resto entra sobre la marcha.
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add(SHELL))
      .catch(() => undefined) // una instalación sin red no debe abortar el SW
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      // `clients.claim` + `skipWaiting`: sin ellos el SW nuevo espera a que se
      // cierren todas las pestañas, y mientras tanto el usuario sigue con el shell
      // viejo apuntando a chunks que ya no existen (pantalla blanca al actualizar).
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // recursos ajenos: sin tocar
  if (esSoloRed(url)) return; // datos autenticados: nunca a la caché

  // Navegación: red primero (shell fresco), luego caché, luego página propia.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copia = res.clone();
          caches
            .open(CACHE)
            .then((c) => c.put(SHELL, copia))
            .catch(() => undefined);
          return res;
        })
        .catch(() => caches.match(SHELL).then((hit) => hit ?? paginaSinConexion())),
    );
    return;
  }

  /** Guarda una copia en caché sin bloquear la respuesta. */
  const guardar = (res) => {
    if (res.ok && res.type === 'basic') {
      const copia = res.clone();
      caches
        .open(CACHE)
        .then((c) => c.put(req, copia))
        .catch(() => undefined);
    }
    return res;
  };

  // Estáticos inmutables: caché primero (los nombres llevan hash del contenido).
  if (esInmutable(url)) {
    e.respondWith(
      caches
        .match(req)
        .then((hit) => hit ?? fetch(req).then(guardar).catch(() => Response.error())),
    );
    return;
  }

  // El resto de estáticos (URL estable): **red primero**, caché solo como red de
  // seguridad sin conexión. Así la copia offline sigue existiendo, pero estando
  // en línea nunca se sirve una versión vieja.
  e.respondWith(
    fetch(req)
      .then(guardar)
      .catch(() => caches.match(req).then((hit) => hit ?? Response.error())),
  );
});

self.addEventListener('push', (e) => {
  const data = e.data?.json() ?? {};
  e.waitUntil(
    self.registration.showNotification(data.title ?? 'KrakenOS', {
      body: data.body,
      icon: '/icon-192.png',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow(e.notification.data.url));
});
