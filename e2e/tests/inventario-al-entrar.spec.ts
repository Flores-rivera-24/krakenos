import { expect, test } from '@playwright/test';
import { login } from '../lib/auth.js';

/**
 * El agente emite `inventory:snapshot` UNA vez por conexión, y la sesión recién iniciada abre
 * el socket en el layout. La lista tiene que estar ahí al entrar, sin «Escanear» y sin esperar
 * al siguiente barrido del agente (60 s por defecto): el timeout de 10 s es claramente menor.
 */

test.beforeEach(async ({ page }) => {
  await login(page);
});

test('el inventario enseña los aparatos nada más entrar, sin escanear', async ({ page }) => {
  await page.getByRole('link', { name: 'Dispositivos' }).first().click();
  await expect(page.getByText('macbook-emilio').first()).toBeVisible({ timeout: 10_000 });
});

test('el widget de dispositivos del dashboard no empieza en cero', async ({ page }) => {
  // Tras el login se está en el dashboard. El valor es el hermano anterior de la etiqueta «total».
  const total = page
    .getByText('total', { exact: true })
    .locator('xpath=preceding-sibling::span[1]');
  await expect(total).not.toHaveText('0', { timeout: 10_000 });
  await expect(total).toHaveText(/^[1-9]\d*$/);
});
