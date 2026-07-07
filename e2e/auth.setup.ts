import { expect, test as setup } from '@playwright/test';
import { ADMIN } from './lib/fixtures.js';
import { readState } from './lib/server.js';

/**
 * Proyecto `setup` (US-189): ejecuta el **flujo de configuración inicial** con el
 * token out-of-band, creando el primer administrador. Es dependencia de los demás
 * proyectos (corre una sola vez, antes que ellos), de modo que la cuenta ya existe
 * cuando los flujos autenticados hacen login por UI.
 */
setup('crear el primer administrador con el token out-of-band', async ({ page }) => {
  const { setupToken } = readState();
  await page.goto(`/setup?token=${setupToken}`);

  await page.getByLabel('Nombre del hogar').fill(ADMIN.homeName);
  await page.getByLabel('Tu nombre').fill(ADMIN.displayName);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('Confirmar contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Crear administrador' }).click();

  // Éxito → sesión emitida y redirección al dashboard.
  await page.waitForURL('**/');
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
});
