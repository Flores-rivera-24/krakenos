import { expect, test } from '@playwright/test';
import { crearUsuario, ponerIdioma } from '../lib/api.js';

/**
 * El único flujo en **inglés** de toda la suite (US-261).
 *
 * Hasta ahora `playwright.config.ts` fijaba `locale: 'es-ES'` en todos los
 * proyectos —necesario, porque sin él Chromium arranca en `en-US` y los
 * selectores en español fallan—, con el efecto secundario de que **ninguna
 * regresión de i18n era detectable**: el catálogo `en.ts` podía quedarse a
 * medias y la suite seguía en verde.
 *
 * Se prueban las **dos** fuentes de idioma, que son distintas y se descubrió
 * escribiendo esto:
 *   1. **Sin sesión** manda el idioma del navegador (`resolveInitialLocale`).
 *   2. **Con sesión** manda la preferencia guardada del usuario (`User.locale`),
 *      aunque el navegador diga otra cosa. Es lo correcto —una preferencia
 *      explícita gana— y por eso hace falta un usuario con `locale: 'en'` para
 *      ver el catálogo inglés dentro de la app.
 */

const USUARIO_EN = {
  email: 'e2e-en@krakenos.test',
  password: 'contrasena-e2e-123',
  displayName: 'Alex',
  role: 'member' as const,
};

test('sin sesión, la app sigue el idioma del navegador (en-US)', async ({ page }) => {
  await page.goto('/login');

  // Copy del catálogo `en.ts`, no del `es.ts`.
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('con sesión, manda la preferencia guardada del usuario', async ({ page, request }) => {
  await crearUsuario(request, USUARIO_EN);
  await ponerIdioma(request, USUARIO_EN, 'en');

  await page.goto('/login');
  await page.getByLabel('Email').fill(USUARIO_EN.email);
  await page.getByLabel('Password', { exact: true }).fill(USUARIO_EN.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('**/');

  // «Dashboard» es un término retenido (igual en ambos idiomas, ver
  // docs/copy-style.md), así que se asevera uno que SÍ cambia.
  await expect(page.getByRole('link', { name: 'Devices' }).first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'Dispositivos' })).toHaveCount(0);
});
