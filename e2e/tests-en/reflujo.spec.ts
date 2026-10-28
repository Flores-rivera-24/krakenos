import { crearUsuario, ponerIdioma } from '../lib/api.js';
import { registrarReflujo, TEXTOS_EN } from '../lib/reflujo.js';
import { test } from '@playwright/test';

const ADMIN_EN = {
  email: 'e2e-reflujo-en@krakenos.test',
  password: 'contrasena-e2e-123',
  displayName: 'Alex',
  role: 'admin' as const,
};

registrarReflujo(TEXTOS_EN, async (page) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(ADMIN_EN.email);
  await page.getByLabel('Password', { exact: true }).fill(ADMIN_EN.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL('**/');
});

test.beforeAll(async ({ request }) => {
  await crearUsuario(request, ADMIN_EN);
  await ponerIdioma(request, ADMIN_EN, 'en');
});
