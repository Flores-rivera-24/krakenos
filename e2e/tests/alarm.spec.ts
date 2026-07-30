import { expect, test } from '@playwright/test';
import { crearUsuario, desarmarPorApi, ponerPinDeAlarma } from '../lib/api.js';
import { login } from '../lib/auth.js';

/**
 * Alarma con PIN y gating por rol (US-261, desgajado de US-230).
 *
 * Por qué este flujo y no otro: la alarma es lo único de la app que puede sonar a
 * las 3 de la mañana, su desarme es la operación más sensible del hogar, y la 3ª
 * auditoría encontró **dos** fallos justo aquí — el PIN sin rate-limit (AUD3-03,
 * cerrado en US-227) y que la UI hace **descubrir el PIN fallando**, sin mensaje
 * (AUD3-29, pendiente en US-235). Este test fija el comportamiento actual para
 * que US-235 lo cambie a propósito y no por accidente.
 */

const PIN = '4271';

const KID = {
  email: 'e2e-kid@krakenos.test',
  password: 'contrasena-e2e-123',
  displayName: 'Marta',
  role: 'kid' as const,
};

test.describe('alarma', () => {
  test.beforeAll(async ({ request }) => {
    await ponerPinDeAlarma(request, PIN);
    await crearUsuario(request, KID);
  });

  test.afterAll(async ({ request }) => {
    // La DB es compartida entre flujos: no dejar la casa armada ni con PIN.
    await desarmarPorApi(request, PIN);
    await ponerPinDeAlarma(request, null);
  });

  test('armar y desarmar con PIN desde el dashboard (US-188)', async ({ page }) => {
    await login(page);

    const alarma = page.getByRole('heading', { name: 'Alarma' }).locator('../..');
    await expect(alarma.getByText('Desarmada')).toBeVisible();

    await alarma.getByRole('button', { name: 'Armar (Fuera)' }).click();
    // Sale de `disarmed`: el botón de desarme sustituye a los de armado.
    await expect(alarma.getByRole('button', { name: 'Desarmar' })).toBeVisible();

    // Primer intento SIN PIN: el 401 del servidor es lo único que revela que hace
    // falta. Comportamiento actual, documentado como deuda de UX en US-235.
    await expect(alarma.getByLabel('PIN de desarme')).toBeHidden();
    await alarma.getByRole('button', { name: 'Desarmar' }).click();
    await expect(alarma.getByLabel('PIN de desarme')).toBeVisible();

    // Con el PIN correcto sí desarma.
    await alarma.getByLabel('PIN de desarme').fill(PIN);
    await alarma.getByRole('button', { name: 'Desarmar' }).click();
    await expect(alarma.getByText('Desarmada')).toBeVisible();
  });

  test('un PIN incorrecto no desarma la casa', async ({ page, request }) => {
    await login(page);
    const alarma = page.getByRole('heading', { name: 'Alarma' }).locator('../..');

    await alarma.getByRole('button', { name: 'Armar (Noche)' }).click();
    await alarma.getByRole('button', { name: 'Desarmar' }).click(); // revela el campo
    await alarma.getByLabel('PIN de desarme').fill('0000');
    await alarma.getByRole('button', { name: 'Desarmar' }).click();

    await expect(page.getByText('PIN incorrecto')).toBeVisible();
    // Lo que de verdad importa: sigue armada.
    await expect(alarma.getByText('Desarmada')).toBeHidden();

    await desarmarPorApi(request, PIN);
  });

  test('un rol `kid` no puede armar ni desarmar (capacidad home.control)', async ({ page }) => {
    await login(page, KID);

    const alarma = page.getByRole('heading', { name: 'Alarma' }).locator('../..');
    await expect(alarma.getByText('Tu rol no permite armar o desarmar la alarma.')).toBeVisible();
    await expect(alarma.getByRole('button', { name: /Armar/ })).toHaveCount(0);
    await expect(alarma.getByRole('button', { name: 'Desarmar' })).toHaveCount(0);
  });
});
