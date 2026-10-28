import { expect, test, type Page } from '@playwright/test';
import { login } from '../lib/auth.js';
import { MOVIL, expectTapTarget } from '../lib/tactil.js';

/**
 * Área de toque en el celular (390 px): los controles pequeños que no son `Button` llevan la
 * utilidad `tap-target` (un `::before` de 44 px que no cambia su aspecto). jsdom no calcula
 * layout, así que el efecto real —qué elemento recibe el dedo— solo se mide aquí, con
 * `elementFromPoint` (`e2e/lib/tactil.ts`). Escritorio no cambia: el último caso lo ata.
 */

/** Navega client-side (un `goto` perdería el access token) por la barra inferior o el panel «Más». */
async function irA(page: Page, href: string): Promise<void> {
  // Solo la barra inferior y el panel «Más»: otros enlaces del dashboard al mismo destino se mueven.
  const enBarra = page.locator(`nav a[href="${href}"]:visible`);
  if ((await enBarra.count()) > 0) {
    await enBarra.first().click();
    return;
  }
  await page.getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('dialog').locator(`a[href="${href}"]`).click();
}

test.describe('celular', () => {
  test.use({ viewport: MOVIL });

  test('interruptor de Ajustes: 44 px tocables y sin pisar a sus vecinos', async ({ page }) => {
    await login(page);
    await irA(page, '/settings');
    const interruptores = page.getByRole('switch');
    await expect(interruptores.first()).toBeVisible();
    await expectTapTarget(page, interruptores.first(), {
      vecinos: [interruptores.nth(1), interruptores.nth(2)],
    });
  });

  test('favorito de IoT', async ({ page }) => {
    await login(page);
    await irA(page, '/iot');
    // La estrella de una tarjeta con interruptor es contigua a él (centros a 42 px): ese grupo
    // lo resuelve el tamaño real (tarea de grupos contiguos), no esta utilidad. Aquí, una aislada.
    const favorito = page.locator('div:not(:has([role="switch"])) > button[aria-pressed]').first();
    await expect(favorito).toBeVisible();
    await expectTapTarget(page, favorito);
  });

  test('ayuda (HelpHint) de la red WiFi', async ({ page }) => {
    await login(page);
    await irA(page, '/wifi');
    const ayuda = page.getByRole('button', { name: '¿Qué es un SSID oculto?' });
    await expect(ayuda).toBeVisible();
    await expectTapTarget(page, ayuda);
  });

  test('botón copiar de la guía de VPN', async ({ page }) => {
    await login(page);
    await irA(page, '/vpn');
    const copiar = page.getByRole('button', { name: 'Copiar', exact: true }).first();
    await expect(copiar).toBeVisible();
    await expectTapTarget(page, copiar);
  });

  test('cierre del detalle de un dispositivo (slideover)', async ({ page }) => {
    await login(page);
    await irA(page, '/inventory');
    // Con la base recién creada el inventario puede estar vacío hasta el primer barrido.
    const vacio = page.getByRole('button', { name: 'Escanear la red' });
    const aparato = page.getByText('macbook-emilio').first();
    await expect(vacio.or(aparato)).toBeVisible();
    if (await vacio.isVisible()) await vacio.click();
    await aparato.click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    await expectTapTarget(page, dialogo.getByRole('button', { name: 'Cerrar' }));
  });

  test('descartar de un toast', async ({ page }) => {
    await login(page);
    await irA(page, '/iot');
    const favorito = page.getByRole('button', { name: /como favorito$/ }).first();
    await expect(favorito).toBeVisible();
    await favorito.click();
    const descartar = page.getByRole('button', { name: 'Descartar' }).first();
    await expect(descartar).toBeVisible();
    await expectTapTarget(page, descartar);
  });

  test('cierre del panel «Más»', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    const panel = page.getByText('Más secciones');
    await expect(panel).toBeVisible();
    await expectTapTarget(page, page.getByRole('button', { name: 'Cerrar' }));
  });

  test('cerrar sesión de la barra superior mide al menos 44 px de alto', async ({ page }) => {
    await login(page);
    const salir = page.locator('header').getByRole('button', { name: 'Salir' });
    await expect(salir).toBeVisible();
    const caja = (await salir.boundingBox())!;
    expect(caja.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('escritorio', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('el interruptor mide lo mismo que antes: 24 px de alto', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Ajustes' }).first().click();
    const interruptor = page.getByRole('switch').first();
    await expect(interruptor).toBeVisible();
    expect((await interruptor.boundingBox())!.height).toBe(24);
    // El área ampliada no existe: sin `::before`, un punto 20 px por encima ya no es suyo.
    const cae = await interruptor.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const e = document.elementFromPoint(r.x + r.width / 2, r.y - 8);
      return !!e && el.contains(e);
    });
    expect(cae).toBe(false);
  });
});
