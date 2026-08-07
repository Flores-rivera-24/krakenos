import { expect, test } from '@playwright/test';
import { ADMIN, login, observarProblemas, stackOf } from '../lib/harness.js';

/**
 * Ciclo de vida de la sesión en cada montaje. Es el flujo que más se rompe al
 * cambiar de montaje porque depende de tres cosas que **difieren** entre `pnpm
 * dev` y `pnpm prod`: el origen del navegador (Vite proxeando vs el agente
 * sirviendo), los atributos de la cookie de refresh (`secure` se decide con la
 * config real, no con `NODE_ENV=test` como en el arnés de US-189) y el paso por
 * el proxy de Vite, que reescribe cabeceras.
 */

test('la sesión sobrevive a una recarga', async ({ page }, testInfo) => {
  const stack = stackOf(testInfo);
  await login(page);

  await page.reload();

  // Sin rehidratación por cookie, esto rebota a /login.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
  expect(page.url(), `la recarga expulsó la sesión en ${stack}`).not.toContain('/login');
});

test('la cookie de refresh llega al navegador con los atributos correctos', async ({
  page,
  context,
}, testInfo) => {
  const stack = stackOf(testInfo);
  await login(page);

  const cookies = await context.cookies();
  const refresh = cookies.find((c) => c.name === 'krakenos_rt');

  expect(refresh, `no se fijó la cookie de refresh en ${stack}`).toBeDefined();
  expect(refresh?.httpOnly, 'la cookie de refresh debe ser httpOnly (US-91)').toBe(true);
  expect(refresh?.sameSite, 'la cookie de refresh debe ser SameSite=Strict').toBe('Strict');
  expect(refresh?.path, 'la cookie de refresh se acota a /api/auth').toBe('/api/auth');
  // Sobre HTTP plano, `secure` haría que el navegador la descartara y la sesión
  // no sobreviviría a una recarga. Los dos stacks corren sin TLS.
  expect(refresh?.secure, 'sobre HTTP la cookie NO puede ser Secure').toBe(false);
});

test('cerrar sesión limpia la cookie y bloquea la vuelta atrás', async ({
  page,
  context,
}, testInfo) => {
  const stack = stackOf(testInfo);
  await login(page);

  await page.getByRole('button', { name: /Cerrar sesión|Salir/ }).click();
  await page.waitForURL('**/login');

  const refresh = (await context.cookies()).find((c) => c.name === 'krakenos_rt');
  expect(refresh?.value ?? '', `la cookie de refresh sobrevivió al logout en ${stack}`).toBe('');

  // Volver a una ruta protegida tras cerrar sesión debe llevar al login.
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/login/);
});

test('una contraseña incorrecta da un error legible, no una pantalla rota', async ({
  page,
}, testInfo) => {
  const stack = stackOf(testInfo);
  const problemas = observarProblemas(page);

  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(ADMIN.email);
  await page.getByLabel('Contraseña', { exact: true }).fill('esta-no-es-la-buena');
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();

  // El mensaje se muestra; la app no se cae ni se queda en blanco.
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  // Un 401 esperado no es un fallo de red: no debe ensuciar la consola.
  expect(problemas.consola, `errores de consola en un login fallido (${stack})`).toEqual([]);
});
