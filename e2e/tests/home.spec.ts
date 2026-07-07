import { expect, test } from '@playwright/test';
import { login } from '../lib/auth.js';

/**
 * Flujos del hogar autenticados (US-189). La cuenta admin la crea el proyecto
 * `setup`; cada test hace login por UI. Los flujos que aún no aplican (2FA con
 * virtual authenticator, escenas de US-166) quedan en **cuarentena explícita**
 * (`test.fixme`) con su motivo — ver `docs/e2e.md`.
 */

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('hogar: crear una habitación (US-165) y verla aparecer', async ({ page }) => {
  // Navegación client-side (React Router): un `page.goto` recargaría y perdería el
  // access token en memoria (US-91). Se llega por el enlace de la barra lateral.
  await page.getByRole('link', { name: 'Habitaciones' }).first().click();
  await page.getByRole('button', { name: /habitación/i }).first().click();

  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre').fill('Salón E2E');
  await dialog.getByRole('button', { name: 'Guardar' }).click();

  await expect(page.getByText('Salón E2E')).toBeVisible();
});

test('red: escanear el inventario y bloquear un dispositivo', async ({ page }) => {
  await page.getByRole('link', { name: 'Dispositivos' }).first().click();
  // Dispara un barrido (mock) y espera a que aparezca un dispositivo conocido.
  await page.getByRole('button', { name: /Escanear/i }).first().click();
  const device = page.getByText('macbook-emilio').first();
  await expect(device).toBeVisible({ timeout: 15_000 });

  // Abre el detalle y bloquea el acceso a la red.
  await device.click();
  const panel = page.getByRole('dialog');
  await panel.getByRole('button', { name: 'Bloquear acceso a la red' }).click();
  // El bloqueo surtió efecto cuando el botón pasa a ofrecer «Desbloquear».
  await expect(panel.getByRole('button', { name: 'Desbloquear acceso a la red' })).toBeVisible();
});

// --- Cuarentena explícita (flaky-policy, US-189) ---

// 2FA con passkey requiere cablear un virtual authenticator (CDP WebAuthn) por
// toda la ceremonia registro+login; se activará junto con el endurecimiento de
// WebAuthn en e2e. Ver docs/e2e.md.
test.fixme('login con 2FA (passkey vía virtual authenticator)', async () => {});

// Las escenas llegan en US-166 (aún no existe la UI); el flujo se añade entonces.
test.fixme('crear y ejecutar una escena (US-166)', async () => {});
