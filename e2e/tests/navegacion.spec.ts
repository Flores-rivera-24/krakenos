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
    // Con ventana normal la barra NO es el contenedor con scroll (lo es la lista): el pie
    // y «Ajustes» están siempre a la vista sin desplazar nada.
    expect(await aside.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
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

    // Conectar ya no está en la barra inferior (decisión del dueño, 2026-10-27): vive en «Más».
    await page.getByRole('button', { name: 'Más' }).click();
    await page.getByRole('dialog').getByRole('link', { name: 'Conectar' }).click();
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

/**
 * Ventana baja con barra lateral (`md:` o más ancha): móvil apaisado, tableta, o un portátil
 * con el zoom del navegador al 150–175 %. La barra es fija a la altura de la ventana; si el
 * pie (estado, tema, usuario) conserva su alto y la lista solo recibe lo que sobra, esta
 * llegaba a medir 63 px (un enlace). Por debajo del umbral `bajo` de `index.css` la barra
 * ENTERA es un único contenedor con scroll.
 */
test.describe('justo por encima del umbral (1440×600)', () => {
  test.use({ viewport: { width: 1440, height: 600 } });

  test('la barra sigue fija: la lista tiene su scroll propio y enseña al menos 5 enlaces', async ({
    page,
  }) => {
    await login(page);
    const aside = page.locator('aside');
    // La barra no es el contenedor con scroll: lo es la lista (que no cabe entera).
    expect(await aside.evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(1);
    const lista = aside.locator('nav > div').first();
    expect(
      await lista.evaluate((el) => el.scrollHeight - el.clientHeight),
      'la lista debería tener scroll propio (si cupiera entera, el test no probaría nada)',
    ).toBeGreaterThan(100);
    const aLaVista = await aside.locator('nav a').evaluateAll(
      (els) =>
        els.filter((el) => {
          const r = el.getBoundingClientRect();
          const punto = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return punto !== null && el.contains(punto);
        }).length,
    );
    // 5 de la lista + «Ajustes», fijo debajo: es el criterio con el que se eligió el umbral.
    expect(aLaVista, 'enlaces de la nav a la vista').toBeGreaterThanOrEqual(6);
    await expect(aside.getByRole('link', { name: 'Ajustes' })).toBeInViewport();
    await expect(aside.getByRole('button', { name: 'Salir' })).toBeInViewport();
  });
});

for (const { ancho, alto } of [
  { ancho: 844, alto: 390 },
  { ancho: 1024, alto: 500 },
]) {
  for (const colapsada of [false, true]) {
    test.describe(`ventana baja ${ancho}×${alto}${colapsada ? ', barra colapsada' : ''}`, () => {
      test.use({ viewport: { width: ancho, height: alto } });

      test('toda la navegación se alcanza y Dashboard y Ajustes se pueden pulsar', async ({
        page,
      }) => {
        await login(page);
        const aside = page.locator('aside');
        if (colapsada) {
          await aside.getByRole('button', { name: 'Colapsar menú' }).click();
          await expect(aside).toHaveAttribute('data-collapsed', 'true');
        }
        const enlaces = aside.locator('nav a');
        const n = await enlaces.count();
        // Precondición (lo que el test necesita, no una altura): que haya más enlaces de
        // los que caben a la vez, o no distinguiría una lista alcanzable de una recortada.
        expect(n, 'la nav debería tener más enlaces de los que caben').toBeGreaterThan(10);

        // En reposo, la lista no es una ranura de un enlace: se ve una parte útil de ella.
        // `elementFromPoint` respeta el recorte de un contenedor con scroll; la caja no.
        const aLaVista = await enlaces.evaluateAll(
          (els, altoVentana) =>
            els.filter((el) => {
              const r = el.getBoundingClientRect();
              if (r.top < 0 || r.bottom > altoVentana) return false;
              const punto = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
              return punto !== null && el.contains(punto);
            }).length,
          alto,
        );
        expect(aLaVista, 'enlaces de la nav a la vista sin desplazar').toBeGreaterThanOrEqual(5);

        // El desplazamiento es de la barra entera, no de una lista interna.
        const lista = aside.locator('nav > div').first();
        expect(
          await lista.evaluate((el) => el.scrollHeight - el.clientHeight),
          'la lista no debe tener scroll propio',
        ).toBeLessThanOrEqual(1);

        // Todos los enlaces se alcanzan (el de Ajustes queda detrás de la lista).
        for (let i = 0; i < n; i++) {
          const enlace = enlaces.nth(i);
          await enlace.scrollIntoViewIfNeeded();
          await expect(enlace).toBeInViewport();
        }

        // Y con el teclado: Tab desde el primero llega al último, y queda a la vista.
        await enlaces.first().focus();
        for (let i = 1; i < n; i++) await page.keyboard.press('Tab');
        await expect(enlaces.last()).toBeFocused();
        await expect(enlaces.last()).toBeInViewport();

        await aside.getByRole('link', { name: 'Ajustes' }).click();
        await expect(page).toHaveURL(/\/settings$/);
        await aside.getByRole('link', { name: 'Dashboard' }).click();
        await expect(page).toHaveURL(/\/$/);
      });
    });
  }
}
