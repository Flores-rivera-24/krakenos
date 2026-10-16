import { expect, test } from '@playwright/test';
import { login } from '../lib/auth.js';

/**
 * Navegación, scroll y foco: cosas que jsdom no calcula (no hay layout ni scroll real),
 * así que solo se pueden comprobar aquí, en un navegador. Los unitarios atan la receta
 * (clases, `scrollTo`, `aria-disabled`); estos miden el efecto.
 */

test.describe('escritorio', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('la barra lateral no se va con el scroll: la navegación y el pie siguen a la vista', async ({
    page,
  }) => {
    await login(page);
    // Client-side: un `goto` recargaría y perdería el access token en memoria.
    await page.getByRole('link', { name: 'Ajustes' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible();

    const alto = await page.evaluate(() => document.scrollingElement!.scrollHeight);
    // Precondición: si la página cabe en la ventana, el test no probaría nada.
    expect(alto, 'la página de Ajustes debería ser más alta que la ventana').toBeGreaterThan(1500);

    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);

    const aside = page.locator('aside');
    const caja = (await aside.boundingBox())!;
    expect(caja.y).toBeCloseTo(0, 0);
    expect(caja.height).toBeCloseTo(900, 0);
    await expect(aside.getByRole('link', { name: 'Ajustes' })).toBeInViewport();
    await expect(aside.getByRole('button', { name: 'Salir' })).toBeInViewport();
  });

  test('cambiar de idioma o de modo no suelta el foco en <body>', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Ajustes' }).first().click();
    await page.getByRole('button', { name: 'Cuenta', exact: true }).click();

    const activo = () =>
      page.evaluate(() => {
        const a = document.activeElement;
        return a ? `${a.tagName}:${(a.textContent ?? '').trim().slice(0, 12)}` : 'null';
      });

    // El cambio de idioma persiste en el servidor para el admin compartido: se restaura
    // SIEMPRE, o el resto de flujos (que asertan español) heredarían el inglés.
    try {
      await page.getByRole('button', { name: /English/ }).focus();
      await page.keyboard.press('Enter');
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      // El bug no era inmediato: el foco se perdía a los ~100 ms, al reactivarse el botón.
      await page.waitForTimeout(600);
      expect(await activo()).toMatch(/^BUTTON:English/);
    } finally {
      await page.getByRole('button', { name: /Español/ }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    }

    // Modo de la app: también se restaura.
    try {
      await page.getByRole('button', { name: /Sencillo/ }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('button', { name: /Sencillo/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.waitForTimeout(600);
      expect(await activo()).toMatch(/^BUTTON:Sencillo/);
    } finally {
      await page.getByRole('button', { name: /Avanzado/ }).click();
      await expect(page.getByRole('button', { name: /Avanzado/ })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    }
  });

  test('el título de cada ruta es el nombre que lleva el menú', async ({ page }) => {
    await login(page);
    for (const [nombre, titulo] of [
      ['Red WiFi', 'Red WiFi'],
      ['Rutinas', 'Rutinas'],
      ['VPN', 'VPN'],
    ] as const) {
      await page.getByRole('link', { name: nombre, exact: true }).first().click();
      await expect(page).toHaveTitle(`${titulo} · KrakenOS`);
    }
  });
});

test.describe('móvil', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('cambiar de ruta abre la página arriba, con el título a la vista', async ({ page }) => {
    await login(page);
    // Se parte de una página larga y se llega a otra larga: entre dos páginas cortas el
    // navegador recorta el scroll solo y el test no distinguiría un arreglo de su ausencia.
    await page.getByRole('button', { name: 'Más' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Ajustes' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 1500));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(1000);

    await page.getByRole('link', { name: 'Conectar' }).first().click();
    await expect(page).toHaveURL(/\/connect$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // Precondición: que la página de destino PUEDA desplazarse. Sin el arreglo, el navegador
    // deja `scrollY = min(1500, máximo)`, que es > 0 mientras haya algo que desplazar; eso es
    // lo que distingue el arreglo de su ausencia. No se mide una altura absoluta (antes
    // `> 2500`): Conectar crece al llegar sus datos (1890 px al montar, ~7000 con la lista de
    // compatibilidad), así que cualquier umbral alto depende de la rapidez de la máquina.
    expect(
      await page.evaluate(() => document.scrollingElement!.scrollHeight - window.innerHeight),
      'Conectar debería poder desplazarse, o el test no distinguiría el arreglo de su ausencia',
    ).toBeGreaterThan(300);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
  });
});
