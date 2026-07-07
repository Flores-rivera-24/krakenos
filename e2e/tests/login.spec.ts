import { expect, test } from '@playwright/test';
import { login } from '../lib/auth.js';

// Flujo de login desde cero por el formulario (US-189). La cuenta la creó el
// proyecto `setup`.
test('login: entrar con email y contraseña llega al dashboard', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
});
