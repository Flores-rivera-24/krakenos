import { expect, test } from '@playwright/test';
import { crearUsuario } from '../lib/api.js';
import { login } from '../lib/auth.js';

/**
 * Operar el hogar como `member` (US-261).
 *
 * La regla de US-179 que más fácil es romper sin enterarse: encender una luz **no
 * es** `requireRole('admin')`, es la capacidad `home.control` (admin **y**
 * member). Un refactor que cambie el preHandler por `requireRole('admin')` pasa
 * todos los tests de autorización —que comprueban que un *viewer* no puede— y
 * rompe en silencio al miembro de la casa, que es el usuario mayoritario.
 *
 * También se fija el otro lado: `member` no ve «Red avanzada» (`navGroupsForRole`).
 */

const MEMBER = {
  email: 'e2e-member@krakenos.test',
  password: 'contrasena-e2e-123',
  displayName: 'Pablo',
  role: 'member' as const,
};

test.describe('rol member', () => {
  test.beforeAll(async ({ request }) => {
    await crearUsuario(request, MEMBER);
  });

  test('un `member` puede encender un dispositivo IoT (home.control)', async ({ page }) => {
    await login(page, MEMBER);

    await page.getByRole('link', { name: 'IoT' }).first().click();

    // El primer interruptor de la lista (managers mock: siempre hay dispositivos).
    const interruptor = page.getByRole('switch').first();
    await expect(interruptor).toBeVisible();

    const antes = await interruptor.getAttribute('aria-checked');
    await interruptor.click();

    // El toggle es optimista y **revierte** si el servidor rechaza (US-96): que el
    // estado se quede cambiado es la prueba de que el servidor lo aceptó.
    await expect(interruptor).toHaveAttribute('aria-checked', antes === 'true' ? 'false' : 'true');
    await expect(page.getByText(/no tienes permiso|403/i)).toHaveCount(0);
  });

  test('un `member` no ve la sección de red avanzada', async ({ page }) => {
    await login(page, MEMBER);

    // `navGroupsForRole` elimina el grupo entero para member/kid/guest (US-179).
    await expect(page.getByRole('link', { name: 'VLANs' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Firewall' })).toHaveCount(0);
    // Pero sí ve lo cotidiano.
    await expect(page.getByRole('link', { name: 'IoT' }).first()).toBeVisible();
  });
});
