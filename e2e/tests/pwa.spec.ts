import { expect, test } from '@playwright/test';
import { login } from '../lib/auth.js';

/**
 * Instalación como app, en un navegador real. Lo que ningún test de jsdom puede
 * decir: que el manifiesto se sirve y sus iconos responden, que el service worker
 * llega a estar activo en `localhost` (contexto seguro) y que la tarjeta de
 * Ajustes muestra un estado coherente.
 *
 * En Chromium headless `beforeinstallprompt` puede no dispararse, así que la
 * tarjeta se asevera por **coherencia con el entorno**, no por el botón.
 */

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('pwa: el manifiesto se sirve con identidad y los iconos responden', async ({
  page,
  request,
}) => {
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();

  const res = await request.get(new URL(href as string, page.url()).toString());
  expect(res.status()).toBe(200);
  const manifiesto = (await res.json()) as {
    id: string;
    start_url: string;
    display: string;
    launch_handler?: { client_mode?: string };
    icons: { src: string }[];
  };
  expect(manifiesto.id).toBe('/');
  expect(manifiesto.start_url).toBe('/');
  expect(manifiesto.display).toBe('standalone');
  expect(manifiesto.launch_handler?.client_mode).toBe('focus-existing');
  expect(manifiesto.icons.length).toBeGreaterThanOrEqual(3);

  for (const icono of manifiesto.icons) {
    const r = await request.get(new URL(icono.src, page.url()).toString());
    expect(r.status(), icono.src).toBe(200);
    expect(r.headers()['content-type'], icono.src).toContain('image/png');
  }
});

test('pwa: el service worker queda activo en localhost', async ({ page }) => {
  const estado = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return { scope: reg.scope, activo: reg.active?.state ?? null };
  });
  expect(estado.scope).toMatch(/\/$/);
  expect(estado.activo).toBe('activated');
});

test('pwa: Ajustes muestra la tarjeta de instalación en un estado coherente', async ({ page }) => {
  await page.getByRole('link', { name: 'Ajustes' }).first().click();
  await expect(page.getByText('Instalar como app')).toBeVisible();

  // localhost es contexto seguro, así que «sin HTTPS» sería un estado incoherente.
  await expect(page.getByText(/solo permite instalar la app sobre HTTPS/)).toHaveCount(0);

  // Alguno de los estados válidos en un navegador de escritorio con contexto seguro.
  const validos = [
    page.getByRole('button', { name: 'Instalar app' }),
    page.getByText(/ya está instalada como app/),
    page.getByText(/Estás usando KrakenOS como app/),
    page.getByText(/Este navegador no ofrece la instalación desde aquí/),
  ];
  await expect
    .poll(async () => {
      let visibles = 0;
      for (const v of validos) if (await v.isVisible()) visibles++;
      return visibles;
    })
    .toBe(1);
});
