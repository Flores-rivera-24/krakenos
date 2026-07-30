import { expect, test as setup } from '@playwright/test';
import { loginApi } from './lib/api.js';
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

  // US-261: subir el rate-limit de login **solo en el arnés e2e**.
  //
  // El límite real (10/min por IP, US-47) es una protección de producción, y su
  // comportamiento se prueba en los tests de integración del agente
  // (`rate-limit.test.ts`), no aquí. En la suite e2e cada flujo hace su propio
  // login por UI —a propósito, porque `storageState` no funciona con la cookie
  // `SameSite=Strict`— así que al pasar de 5 a 13 flujos la tanda se comió el
  // límite y varios tests cayeron con «No se pudo conectar con el servidor».
  // Sin esto, añadir un flujo nuevo rompe otros al azar.
  // El access token vive **solo en memoria** del store (US-91), así que no se
  // puede leer desde la página: se pide uno por API para esta única llamada.
  const token = await loginApi(page.request);
  const res = await page.request.patch('/api/system/settings', {
    headers: { Authorization: `Bearer ${token}` },
    // El cuerpo es `{key, value}` con el valor como **cadena**, no un objeto de
    // ajustes (`updateSettingSchema`); mandarlo mal devuelve 400 en silencio.
    data: { key: 'loginRateLimit', value: '1000' },
  });
  // Si el borde lo rechaza, se avisa en vez de fallar en silencio: el síntoma
  // sería un flujo cualquiera en rojo dentro de diez minutos.
  if (!res.ok()) {
    console.warn(
      `[e2e] no se pudo subir loginRateLimit (${res.status()}): la suite puede ` +
        'agotar el límite de login si crece. Ver US-261.',
    );
  }
});
