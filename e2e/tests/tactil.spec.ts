import { expect, test, type Page } from '@playwright/test';
import { login } from '../lib/auth.js';
import { MOVIL, MOVIL_ESTRECHO, esperarContenidoQuieto, expectTapTarget } from '../lib/tactil.js';

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

  test('un término de glosario en línea NO amplía su área: no roba el toque a las líneas vecinas', async ({
    page,
  }) => {
    await login(page);
    await irA(page, '/dns');
    const termino = page.locator('p button[aria-expanded]').first();
    await expect(termino).toBeVisible();
    const caja = (await termino.boundingBox())!;
    for (const dy of [-21, 21]) {
      const cae = await termino.evaluate(
        (el, p) => {
          const e = document.elementFromPoint(p.x, p.y);
          return !!e && el.contains(e);
        },
        { x: caja.x + caja.width / 2, y: caja.y + caja.height / 2 + dy },
      );
      expect(cae, `a ${dy} px en vertical del término`).toBe(false);
    }
  });

  test('borrar una alerta de energía', async ({ page }) => {
    await login(page);
    await irA(page, '/energy');
    await page.getByLabel('Umbral', { exact: true }).fill('150');
    await page.getByRole('button', { name: 'Añadir', exact: true }).click();
    const borrar = page.getByRole('button', { name: 'Eliminar alerta' }).first();
    await expect(borrar).toBeVisible();
    await expectTapTarget(page, borrar);
  });

  test('mover y ocultar un widget del dashboard (modo edición) con sus vecinos', async ({
    page,
  }) => {
    await login(page);
    await page.getByRole('button', { name: 'Personalizar' }).click();
    const subir = page.getByRole('button', { name: /^Subir / }).first();
    await expect(subir).toBeVisible();
    // La barra inferior es fija: se centra la fila para que no quede tapada al medir.
    await subir.evaluate((el) => el.scrollIntoView({ block: 'center' }));
    const fila = subir.locator('..');
    const botones = fila.getByRole('button');
    await expect(botones).toHaveCount(3);
    await expectTapTarget(page, botones.nth(0), { vecinos: [botones.nth(1)] });
    await expectTapTarget(page, botones.nth(1), { vecinos: [botones.nth(0), botones.nth(2)] });
    await expectTapTarget(page, botones.nth(2), { vecinos: [botones.nth(1)] });
  });

  test('rango de Energía con sus hermanos', async ({ page }) => {
    await login(page);
    await irA(page, '/energy');
    const botones = page.getByRole('group', { name: 'Rango' }).getByRole('button');
    await expect(botones.first()).toBeVisible();
    const n = await botones.count();
    for (let i = 0; i < n; i++) {
      const vecinos = [];
      if (i > 0) vecinos.push(botones.nth(i - 1));
      if (i < n - 1) vecinos.push(botones.nth(i + 1));
      await expectTapTarget(page, botones.nth(i), { vecinos });
    }
  });

  test('estrella y interruptor de IoT son contiguos: ninguna pisa a la otra', async ({ page }) => {
    await login(page);
    await irA(page, '/iot');
    const interruptor = page.getByRole('switch').first();
    await expect(interruptor).toBeVisible();
    const estrella = interruptor.locator('xpath=preceding-sibling::button[@aria-pressed][1]');
    await expectTapTarget(page, estrella, { vecinos: [interruptor] });
    await expectTapTarget(page, interruptor, { vecinos: [estrella] });
  });

  test('cerrar sesión de la barra superior mide al menos 44 px de alto', async ({ page }) => {
    await login(page);
    const salir = page.locator('header').getByRole('button', { name: 'Salir' });
    await expect(salir).toBeVisible();
    const caja = (await salir.boundingBox())!;
    expect(caja.height).toBeGreaterThanOrEqual(44);
  });

  test('los campos del celular son de 16 px (sin zoom al enfocar) y de 44 px de alto', async ({
    page,
  }) => {
    await page.goto('/login');
    const correo = page.getByLabel('Correo electrónico');
    await expect(correo).toBeVisible();
    expect(await correo.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
    expect((await correo.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    await login(page);
    await irA(page, '/settings');
    const lista = page.locator('main select:visible').first();
    await expect(lista).toBeVisible();
    expect(await lista.evaluate((el) => getComputedStyle(el).fontSize)).toBe('16px');
    expect((await lista.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('celular: capas', () => {
  test.use({ viewport: MOVIL });

  test('un toast cabe entero en la pantalla y queda por encima de la barra inferior', async ({
    page,
  }) => {
    await login(page);
    await irA(page, '/iot');
    const favorito = page.getByRole('button', { name: /como favorito$/ }).first();
    await expect(favorito).toBeVisible();
    await favorito.click();
    const descartar = page.getByRole('button', { name: 'Descartar' }).first();
    await expect(descartar).toBeVisible();
    const toast = descartar.locator('xpath=ancestor::div[@aria-live][1]/*[1]');
    const caja = (await toast.boundingBox())!;
    const ancho = await page.evaluate(() => window.innerWidth);
    const barra = (await page.locator('nav.fixed').boundingBox())!;
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width).toBeLessThanOrEqual(ancho);
    expect(caja.y + caja.height).toBeLessThanOrEqual(barra.y);
    // Deshace el favorito para no dejar estado en la base compartida.
    await descartar.click();
    await page
      .getByRole('button', { name: /^Quitar .* de favoritos$/ })
      .first()
      .click();
  });

  test('el panel «Más» no se solapa con la barra inferior', async ({ page }) => {
    await login(page);
    await page.getByRole('button', { name: 'Más', exact: true }).click();
    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    const barra = (await page.locator('nav.fixed').boundingBox())!;
    const caja = (await panel.boundingBox())!;
    expect(caja.y + caja.height).toBeLessThanOrEqual(barra.y);
  });

  /** ~25 clientes con la forma real de `WifiClient[]`, para que la lista desborde el panel. */
  async function conVeinticincoClientes(page: Page): Promise<void> {
    await page.route('**/api/wifi/networks/*/clients', (ruta) =>
      ruta.fulfill({
        json: Array.from({ length: 25 }, (_, i) => ({
          mac: `de:ad:be:ef:00:${i.toString(16).padStart(2, '0')}`,
          hostname: `cliente-${i + 1}`,
          ip: `192.168.1.${50 + i}`,
          signalDbm: -50 - i,
        })),
      }),
    );
  }

  async function abrirClientes(page: Page) {
    await irA(page, '/wifi');
    // El número de clientes de una red es el botón que abre la lista (diálogo de «Redes»).
    const clientes = page.locator('td button:not([disabled])').first();
    await expect(clientes).toBeVisible();
    await clientes.click();
    const dialogo = page.getByRole('dialog');
    await expect(dialogo).toBeVisible();
    await expect(dialogo.locator('tbody tr')).toHaveCount(25);
    return dialogo;
  }

  test('un diálogo apaisado (844 × 390) cabe en la ventana y se desplaza por dentro', async ({
    page,
  }) => {
    await conVeinticincoClientes(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await login(page);
    const dialogo = await abrirClientes(page);
    // Sin desplazar la página: el panel está entero en la ventana (no centrado en `main`).
    const caja = (await dialogo.boundingBox())!;
    expect(caja.y).toBeGreaterThanOrEqual(0);
    expect(caja.y + caja.height).toBeLessThanOrEqual(390);
    const medidas = await dialogo.evaluate((el) => ({
      scroll: el.scrollHeight,
      cliente: el.clientHeight,
    }));
    expect(medidas.scroll).toBeGreaterThan(medidas.cliente);
    // El último cliente se alcanza desplazando EL PANEL, no la página.
    const ultima = dialogo.locator('tbody tr').last();
    await ultima.scrollIntoViewIfNeeded();
    const fila = (await ultima.boundingBox())!;
    const panel = (await dialogo.boundingBox())!;
    expect(fila.y).toBeGreaterThanOrEqual(panel.y);
    expect(fila.y + fila.height).toBeLessThanOrEqual(panel.y + panel.height + 1);
  });

  test('un diálogo con la página desplazada queda en la ventana y la barra inferior no lo tapa', async ({
    page,
  }) => {
    await conVeinticincoClientes(page);
    await login(page);
    await irA(page, '/wifi');
    await expect(page.locator('td button:not([disabled])').first()).toBeVisible();
    await esperarContenidoQuieto(page);
    // Página larga desplazada hacia abajo antes de abrir.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const dialogo = await abrirClientes(page);
    const alto = await page.evaluate(() => window.innerHeight);
    const caja = (await dialogo.boundingBox())!;
    expect(caja.y).toBeGreaterThanOrEqual(0);
    expect(caja.y + caja.height).toBeLessThanOrEqual(alto);
    // Lo que hay en el centro del borde inferior del diálogo pertenece al diálogo (no a la barra).
    const encima = await dialogo.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const hallado = document.elementFromPoint(r.x + r.width / 2, r.y + r.height - 2);
      return !!hallado && el.contains(hallado);
    });
    expect(encima, 'la barra inferior tapa el borde del diálogo').toBe(true);
  });
});

test.describe('celular estrecho', () => {
  test.use({ viewport: MOVIL_ESTRECHO });

  test('la burbuja de ayuda de la red WiFi queda dentro de la pantalla', async ({ page }) => {
    await login(page);
    await irA(page, '/wifi');
    const ayuda = page.getByRole('button', { name: '¿Qué es un SSID oculto?' });
    await expect(ayuda).toBeVisible();
    await ayuda.click();
    const burbuja = page.getByRole('tooltip');
    await expect(burbuja).toBeVisible();
    const caja = (await burbuja.boundingBox())!;
    expect(caja.x).toBeGreaterThanOrEqual(0);
    expect(caja.x + caja.width).toBeLessThanOrEqual(320);
  });
});

test.describe('escritorio', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('el toast sigue en la esquina inferior derecha con su ancho de siempre', async ({
    page,
  }) => {
    await login(page);
    await page.getByRole('link', { name: 'IoT', exact: true }).first().click();
    const favorito = page.getByRole('button', { name: /como favorito$/ }).first();
    await expect(favorito).toBeVisible();
    await favorito.click();
    const descartar = page.getByRole('button', { name: 'Descartar' }).first();
    await expect(descartar).toBeVisible();
    const contenedor = descartar.locator('xpath=ancestor::div[@aria-live][1]');
    const caja = (await contenedor.boundingBox())!;
    expect(caja.width).toBeCloseTo(384, 1);
    expect(caja.x + caja.width).toBeCloseTo(1280 - 16, 1);
    expect(caja.y + caja.height).toBeCloseTo(800 - 16, 1);
    await descartar.click();
    await page
      .getByRole('button', { name: /^Quitar .* de favoritos$/ })
      .first()
      .click();
  });

  test('el interruptor mide lo mismo que antes: 24 px de alto', async ({ page }) => {
    await login(page);
    await page.getByRole('link', { name: 'Ajustes' }).first().click();
    const interruptor = page.getByRole('switch').first();
    await expect(interruptor).toBeVisible();
    await esperarContenidoQuieto(page);
    expect((await interruptor.boundingBox())!.height).toBeCloseTo(24, 1);
    // El área ampliada no existe: sin `::before`, un punto 20 px por encima ya no es suyo.
    const cae = await interruptor.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const e = document.elementFromPoint(r.x + r.width / 2, r.y - 8);
      return !!e && el.contains(e);
    });
    expect(cae).toBe(false);
  });
  test('mover/ocultar del dashboard, el rango de Energía y la estrella de IoT miden lo mismo que antes', async ({
    page,
  }) => {
    await login(page);
    await page.getByRole('button', { name: 'Personalizar' }).click();
    const subir = page.getByRole('button', { name: /^Subir / }).first();
    await expect(subir).toBeVisible();
    await esperarContenidoQuieto(page);
    const cajaSubir = (await subir.boundingBox())!;
    expect(cajaSubir.width).toBeCloseTo(24, 1);
    expect(cajaSubir.height).toBeCloseTo(24, 1);

    await page.getByRole('link', { name: 'Energía' }).first().click();
    const rango = page.getByRole('group', { name: 'Rango' }).getByRole('button').first();
    await expect(rango).toBeVisible();
    await esperarContenidoQuieto(page);
    expect((await rango.boundingBox())!.height).toBeCloseTo(24, 1);

    await page.getByRole('link', { name: 'IoT', exact: true }).first().click();
    const interruptor = page.getByRole('switch').first();
    await expect(interruptor).toBeVisible();
    const estrella = interruptor.locator('xpath=preceding-sibling::button[@aria-pressed][1]');
    await esperarContenidoQuieto(page);
    const cajaEstrella = (await estrella.boundingBox())!;
    expect(cajaEstrella.width).toBeCloseTo(32, 1);
    expect(cajaEstrella.height).toBeCloseTo(32, 1);
  });

  test('los campos miden lo mismo que antes: 14 px de letra y 40 px de alto', async ({ page }) => {
    await page.goto('/login');
    const correo = page.getByLabel('Correo electrónico');
    await expect(correo).toBeVisible();
    expect(await correo.evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px');
    expect((await correo.boundingBox())!.height).toBeCloseTo(40, 1);

    await login(page);
    await page.getByRole('link', { name: 'Ajustes' }).first().click();
    const lista = page.locator('main select:visible').first();
    await expect(lista).toBeVisible();
    await esperarContenidoQuieto(page);
    expect(await lista.evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px');
    expect((await lista.boundingBox())!.height).toBeCloseTo(40, 1);
  });
  test('el precio de Energía mide lo mismo que antes: 14 px de letra y 30 px de alto', async ({
    page,
  }) => {
    await login(page);
    await page.getByRole('link', { name: 'Energía' }).first().click();
    const precio = page.getByLabel('Precio por kWh');
    await expect(precio).toBeVisible();
    await expect(precio).toBeEnabled();
    await esperarContenidoQuieto(page);
    expect(await precio.evaluate((el) => getComputedStyle(el).fontSize)).toBe('14px');
    expect((await precio.boundingBox())!.height).toBeCloseTo(30, 1);
  });
});
