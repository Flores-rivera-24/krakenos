import { expect, test } from '@playwright/test';
import { login } from '../lib/auth.js';

// Flujo de login desde cero por el formulario (US-189). La cuenta la creó el
// proyecto `setup`.
test('login: entrar con email y contraseña llega al dashboard', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
});

// Ata el `space-y-*` de `index.css`. Tailwind 4 pone el margen en el hermano de arriba, y un
// `<label>` en línea lo ignora: sin la neutralización de `index.css` (que depende de un nombre
// interno de Tailwind, `--tw-space-y-reverse`), el hueco entre etiqueta y campo desaparece en
// ~33 formularios sin ningún error. 26 px = la distancia arriba-con-arriba medida con
// Tailwind 3 (etiqueta de 17 px + 9 px de hueco); sin la neutralización sale ~20.
test('login: el hueco entre la etiqueta y el campo es el de siempre (space-y)', async ({
  page,
}) => {
  await page.goto('/login');
  const etiqueta = await page.getByText('Correo electrónico', { exact: true }).boundingBox();
  const campo = await page.locator('input#email').boundingBox();
  expect(etiqueta).not.toBeNull();
  expect(campo).not.toBeNull();
  expect(Math.abs(campo!.y - etiqueta!.y - 26)).toBeLessThanOrEqual(1);
});

// La otra mitad: la regla de la v4 (`margin-bottom` en cada hijo salvo el último) tiene que quedar
// anulada. En un contenedor flex los márgenes no colapsan, así que con las dos activas el hueco se
// DUPLICA (32 px en vez de 16). Ningún formulario actual es flex con `space-y`, por eso se
// comprueba con un contenedor inyectado: es lo único que ata esa línea de `index.css`.
test('space-y: la regla de la v4 no se suma a la de la v3 (sin hueco doble)', async ({ page }) => {
  await page.goto('/login');
  const huecos = await page.evaluate(() => {
    const c = document.createElement('div');
    c.className = 'flex flex-col space-y-4';
    c.innerHTML = '<div id="kr-a">a</div><div id="kr-b">b</div><div id="kr-c">c</div>';
    document.body.append(c);
    const r = (id: string) => document.getElementById(id)!.getBoundingClientRect();
    return { ab: r('kr-b').top - r('kr-a').bottom, bc: r('kr-c').top - r('kr-b').bottom };
  });
  expect(huecos.ab).toBeCloseTo(16, 0);
  expect(huecos.bc).toBeCloseTo(16, 0);
});
