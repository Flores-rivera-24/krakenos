import { expect, type Page } from '@playwright/test';
import { ADMIN } from './fixtures.js';

/**
 * Inicia sesión por el formulario de login (US-189). Se usa un login por UI en vez
 * de reutilizar `storageState` porque Chromium no envía cookies `SameSite=Strict`
 * inyectadas en el primer fetch de bootstrap (la sesión no se restauraría). El
 * login por formulario emite el access token en memoria de forma fiable.
 */
export async function login(page: Page, creds = ADMIN): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(creds.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(creds.password);
  // `exact: true` por lo mismo que la etiqueta de la contraseña: el `name` casa por
  // subcadena, así que cualquier copy futuro que CONTENGA «Iniciar sesión» rompería
  // el helper del que dependen todos los flujos. En inglés ya pasó (US-269).
  await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
  await page.waitForURL('**/');
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
}
