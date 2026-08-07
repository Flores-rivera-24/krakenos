import { expect, test as setup } from '@playwright/test';
import { ADMIN, observarProblemas, stackOf } from '../lib/harness.js';
import { readStacksState } from '../lib/stacks.js';

/**
 * Crea el primer administrador de **su** stack recorriendo el wizard real con el
 * token out-of-band. Corre una vez por stack (cada uno tiene su propia DB) y es
 * dependencia del proyecto de flujos correspondiente.
 *
 * No es solo preparación: el wizard de configuración es la **primera pantalla**
 * que ve cualquiera que instale KrakenOS, y es la única que se sirve sin sesión
 * en la que un fallo de montaje deja al usuario sin salida. Por eso asevera
 * también que no hubo errores de consola ni peticiones caídas.
 */
setup('recorrer el wizard de configuración y crear el administrador', async ({ page }, testInfo) => {
  const stack = stackOf(testInfo);
  const { setupToken } = readStacksState();
  const problemas = observarProblemas(page);

  await page.goto(`/setup?token=${setupToken[stack]}`);

  await page.getByLabel('Nombre del hogar').fill(ADMIN.homeName);
  await page.getByLabel('Tu nombre').fill(ADMIN.displayName);
  await page.getByLabel('Email').fill(ADMIN.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(ADMIN.password);
  await page.getByLabel('Confirmar contraseña').fill(ADMIN.password);
  await page.getByRole('button', { name: 'Crear administrador' }).click();

  await page.waitForURL('**/');
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();

  expect(problemas.consola, `errores de consola en el wizard (${stack})`).toEqual([]);
  expect(problemas.peticiones, `peticiones caídas en el wizard (${stack})`).toEqual([]);
  expect(problemas.respuestasFallidas, `respuestas 4xx/5xx en el wizard (${stack})`).toEqual([]);

  // Sube el rate-limit de login **solo en el arnés** (misma razón que en US-261):
  // cada flujo hace su propio login por UI, y el límite real (10/min por IP) se
  // agota a mitad de tanda haciendo caer tests al azar por «no se pudo conectar».
  const login = await page.request.post('/api/auth/login', {
    data: { email: ADMIN.email, password: ADMIN.password },
  });
  const token = ((await login.json()) as { tokens?: { accessToken: string } }).tokens?.accessToken;
  const res = await page.request.patch('/api/system/settings', {
    headers: { Authorization: `Bearer ${token ?? ''}` },
    data: { key: 'loginRateLimit', value: '1000' },
  });
  if (!res.ok()) {
    console.warn(`[stacks] no se pudo subir loginRateLimit en ${stack} (${res.status()}).`);
  }
});
