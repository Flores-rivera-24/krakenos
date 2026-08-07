import { expect, type Page, test } from '@playwright/test';
import { login, stackOf } from '../lib/harness.js';

/**
 * Service worker: existe en producción y **no** en desarrollo.
 *
 * `localhost` es contexto seguro, así que hasta US-234 incluido el SW se
 * registraba también con `pnpm dev` y se ponía por delante de los módulos que
 * sirve Vite. Su estrategia para todo lo que no era navegación era «caché
 * primero», correcta con nombres hasheados (producción) y dañina con las URL
 * **estables** de Vite (`/src/App.tsx`, `/@vite/client`): la app quedaba clavada
 * en la primera versión cacheada, el último cambio no aparecía al recargar y no
 * había ningún error que lo explicara.
 *
 * Estos tests fijan las dos mitades del arreglo: no registrarlo en desarrollo
 * (`lib/pwa.ts`) y cachear «caché primero» solo lo inmutable (`public/sw.js`).
 */

/** Espera a que el SW tome el control de la página (`clients.claim`). */
async function esperarControl(page: Page): Promise<boolean> {
  return await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    if (navigator.serviceWorker.controller) return true;
    await new Promise((r) => {
      navigator.serviceWorker.addEventListener('controllerchange', r, { once: true });
      setTimeout(r, 10_000);
    });
    return !!navigator.serviceWorker.controller;
  });
}

/** Rutas que el SW tiene cacheadas, en todas sus cachés. */
async function urlsEnCache(page: Page): Promise<string[]> {
  return await page.evaluate(async () => {
    const urls: string[] = [];
    for (const nombre of await caches.keys()) {
      const c = await caches.open(nombre);
      for (const req of await c.keys()) urls.push(new URL(req.url).pathname);
    }
    return urls;
  });
}

test('el service worker solo existe en producción', async ({ page }, testInfo) => {
  const stack = stackOf(testInfo);
  await login(page);

  const controla = await esperarControl(page);

  if (stack === 'prod') {
    expect(controla, 'en producción la PWA debe estar activa (US-234)').toBe(true);
  } else {
    expect(
      controla,
      'en desarrollo NO debe haber service worker: cachearía los módulos de Vite, ' +
        'cuyas URL no llevan hash, y serviría código viejo al recargar',
    ).toBe(false);
  }
});

test('nada de URL estable se sirve desde caché', async ({ page }, testInfo) => {
  const stack = stackOf(testInfo);
  test.skip(stack === 'dev', 'en desarrollo no hay service worker que pueda cachear');

  await login(page);
  await esperarControl(page);

  // Segunda carga: la primera pobló la caché, la segunda la usaría.
  await page.reload();
  await page.waitForLoadState('networkidle');

  const urls = await urlsEnCache(page);

  // Lo único que se sirve «caché primero» son los assets hasheados y el shell.
  // El resto puede acabar en caché como red de seguridad sin conexión, pero se
  // pide por red primero, así que estando en línea nunca se sirve obsoleto.
  const conHash = (p: string) => p.startsWith('/assets/');
  const shell = (p: string) => p === '/index.html' || p === '/';

  const sospechosas = urls.filter((u) => !conHash(u) && !shell(u));

  // Ninguna ruta de módulo de desarrollo puede aparecer jamás.
  const deDesarrollo = urls.filter(
    (u) => u.startsWith('/src/') || u.startsWith('/@') || u.includes('/.vite/'),
  );
  expect(deDesarrollo, 'módulos de Vite en la caché del service worker').toEqual([]);

  // Y lo que se cachee sin hash debe ser poco y conocido: si esta lista crece,
  // alguien añadió un estático de URL estable y conviene mirarlo.
  expect(
    sospechosas.every((u) => /\.(png|svg|json|js|css|woff2?)$/.test(u)),
    `entradas inesperadas en la caché (${stack}): ${sospechosas.join(', ')}`,
  ).toBe(true);
});
