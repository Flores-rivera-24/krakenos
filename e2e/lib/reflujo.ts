import { expect, test, type Page } from '@playwright/test';
import { loginApi } from './api.js';
import { MOVIL_ESTRECHO } from './tactil.js';

/**
 * Reflujo a 320 px: las cabeceras, los formularios y las tablas se reacomodan en vez de
 * desbordar la página en horizontal. jsdom no calcula layout, así que solo un navegador puede
 * medir `scrollWidth`. Se comparte entre `tests/reflujo.spec.ts` (español) y
 * `tests-en/reflujo.spec.ts` (inglés, donde las etiquetas son más largas), porque cada proyecto
 * de Playwright tiene su propio `testDir`.
 */

interface Textos {
  /** Panel «Más» de la barra inferior. */
  mas: RegExp;
  secciones: { seguridad: string; integraciones: string };
  /** Títulos que prueban que la sección ya pintó. */
  sesiones: string;
  mqtt: string;
  peligro: string;
  vistas: string;
  editar: string;
  herramientasPlano: string;
  nuevaAutomatizacion: string;
  /** Botón de exportar de Energía (cabecera lista) y título de Tráfico. */
  exportar: string;
  ancho: string;
  cerrar: string;
  modoHogar: string;
}

export const TEXTOS_ES: Textos = {
  mas: /^Más$/,
  secciones: { seguridad: 'Seguridad', integraciones: 'Integraciones' },
  sesiones: 'Sesiones activas',
  mqtt: 'Publicar a MQTT',
  peligro: 'Zona de peligro',
  vistas: 'Vista',
  editar: 'Editar',
  herramientasPlano: 'Herramientas del plano',
  nuevaAutomatizacion: 'Nueva automatización',
  exportar: 'Exportar CSV',
  ancho: 'Ancho de banda (Mbps)',
  cerrar: 'Cerrar',
  modoHogar: 'Modo del hogar',
};

export const TEXTOS_EN: Textos = {
  mas: /^More$/,
  secciones: { seguridad: 'Security', integraciones: 'Integrations' },
  sesiones: 'Active sessions',
  mqtt: 'Publish to MQTT',
  peligro: 'Danger zone',
  vistas: 'View',
  editar: 'Edit',
  herramientasPlano: 'Floor plan tools',
  nuevaAutomatizacion: 'New automation',
  exportar: 'Export CSV',
  ancho: 'Bandwidth (Mbps)',
  cerrar: 'Close',
  modoHogar: 'Home mode',
};

/** Navega client-side (un `goto` perdería el access token) por la barra inferior o el panel «Más». */
async function irA(page: Page, href: string, mas: RegExp): Promise<void> {
  // La barra inferior tiene que estar pintada antes de contar: con 0 enlaces se abriría «Más» sin motivo.
  await page.locator('nav a:visible').first().waitFor();
  const enBarra = page.locator(`nav a[href="${href}"]:visible`);
  if ((await enBarra.count()) > 0) {
    await enBarra.first().click();
    return;
  }
  await page.getByRole('button', { name: mas }).click();
  await page.getByRole('dialog').locator(`a[href="${href}"]`).click();
}

/** La página no se desplaza en horizontal. Se reintenta: el layout termina de asentarse tras el dato. */
async function sinDesborde(page: Page, donde: string): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => ({
          ancho: document.documentElement.scrollWidth,
          ventana: window.innerWidth,
        })),
      { message: `${donde} desborda en horizontal`, timeout: 5000 },
    )
    .toEqual(
      expect.objectContaining({ ancho: MOVIL_ESTRECHO.width, ventana: MOVIL_ESTRECHO.width }),
    );
}

/** Cambia de sección en Ajustes (la barra de secciones es el único `nav` con botones). */
async function seccion(page: Page, nombre: string): Promise<void> {
  const nav = page.locator('nav[aria-label]').filter({ has: page.getByRole('button') });
  await nav.getByRole('button', { name: nombre }).click();
}

export function registrarReflujo(textos: Textos, entrar: (page: Page) => Promise<void>): void {
  test.describe('reflujo a 320 px', () => {
    test.use({ viewport: MOVIL_ESTRECHO });

    test('Panel: el selector de modo del hogar cabe', async ({ page }) => {
      await entrar(page);
      await expect(page.getByRole('group', { name: textos.modoHogar })).toBeVisible();
      await expect(
        page.getByRole('group', { name: textos.modoHogar }).getByRole('button').first(),
      ).toBeVisible();
      await sinDesborde(page, 'Panel');
      // Cada botón de modo cabe dentro de su rejilla (el texto largo no se sale del botón).
      const salen = await page
        .getByRole('group', { name: textos.modoHogar })
        .getByRole('button')
        .evaluateAll((botones) =>
          botones.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent),
        );
      expect(salen, 'botones de modo con texto recortado').toEqual([]);
    });

    test('Energía: la cabecera del gráfico cabe', async ({ page }) => {
      await entrar(page);
      await irA(page, '/energy', textos.mas);
      await expect(page.getByRole('button', { name: textos.exportar })).toBeVisible();
      await sinDesborde(page, 'Energía');
    });

    test('Tráfico: la cabecera del gráfico cabe', async ({ page }) => {
      await entrar(page);
      await irA(page, '/traffic', textos.mas);
      await expect(page.getByText(textos.ancho)).toBeVisible();
      await sinDesborde(page, 'Tráfico');
    });

    test('Ajustes: la sección de Seguridad cabe', async ({ page }) => {
      await entrar(page);
      await irA(page, '/settings', textos.mas);
      await seccion(page, textos.secciones.seguridad);
      await expect(page.getByText(textos.sesiones, { exact: true })).toBeVisible();
      await expect(page.getByText(textos.peligro)).toBeVisible();
      await sinDesborde(page, 'Ajustes > Seguridad');
    });

    test('Ajustes: el formulario de MQTT cabe', async ({ page }) => {
      await entrar(page);
      await irA(page, '/settings', textos.mas);
      await seccion(page, textos.secciones.integraciones);
      await expect(page.getByText(textos.mqtt, { exact: true })).toBeVisible();
      await sinDesborde(page, 'Ajustes > Integraciones');
    });

    test('Wi-Fi: el diálogo de clientes cabe en su panel', async ({ page }) => {
      await entrar(page);
      await irA(page, '/wifi', textos.mas);
      const clientes = page
        .locator('table button')
        .filter({ hasText: /^[1-9]\d*$/ })
        .first();
      await expect(clientes).toBeVisible();
      await sinDesborde(page, 'Wi-Fi');
      await clientes.click();
      const dialogo = page.getByRole('dialog');
      await expect(dialogo.getByRole('button', { name: textos.cerrar })).toBeVisible();
      await expect(dialogo.locator('tbody tr').first()).toBeVisible();
      await sinDesborde(page, 'Wi-Fi con el diálogo');
      const fuera = await dialogo.evaluate((panel) => {
        const caja = panel.getBoundingClientRect();
        return Array.from(panel.querySelectorAll('th, td'))
          .filter((c) => {
            const r = c.getBoundingClientRect();
            return r.left < caja.left - 1 || r.right > caja.right + 1;
          })
          .map((c) => c.textContent);
      });
      expect(fuera, 'celdas fuera del panel del diálogo').toEqual([]);
    });

    test('Wi-Fi: un nombre de cliente muy largo se recorta dentro del panel', async ({ page }) => {
      const largo = 'dispositivo-con-un-nombre-larguisimo-de-prueba-0123456789-abcdefghij';
      // Se responde SOLO la lista de clientes de la red (misma forma que el mock: WifiClient[]).
      await page.route('**/api/wifi/networks/*/clients', (ruta) =>
        ruta.fulfill({
          json: [{ mac: 'de:ad:be:ef:00:01', hostname: largo, ip: '192.168.1.50', signalDbm: -61 }],
        }),
      );
      await entrar(page);
      await irA(page, '/wifi', textos.mas);
      const clientes = page
        .locator('table button')
        .filter({ hasText: /^[1-9]\d*$/ })
        .first();
      await clientes.click();
      const dialogo = page.getByRole('dialog');
      const celda = dialogo.locator('tbody td').first();
      await expect(celda).toHaveText(largo);
      await expect(celda).toHaveAttribute('title', largo);
      await sinDesborde(page, 'Wi-Fi con un nombre largo');
      const medida = await celda.evaluate((td) => {
        const panel = td.closest('[role="dialog"]')!.getBoundingClientRect();
        const caja = td.getBoundingClientRect();
        return {
          dentro: caja.left >= panel.left - 1 && caja.right <= panel.right + 1,
          // `scrollWidth > clientWidth`: el texto se corta (con puntos suspensivos), no se desborda.
          recortado: td.scrollWidth > td.clientWidth,
        };
      });
      expect(medida, 'la celda cabe en el panel y recorta el texto').toEqual({
        dentro: true,
        recortado: true,
      });
    });

    test('Cobertura: la barra de herramientas cabe', async ({ page, request }) => {
      // Sin plano la página solo enseña su estado vacío y no hay barra que medir: se crea uno
      // por API y se retira al terminar (los flujos comparten una sola DB).
      const token = await loginApi(request);
      const cabeceras = { Authorization: `Bearer ${token}` };
      const creado = await request.post('/api/coverage/floorplans', {
        headers: cabeceras,
        data: { name: 'Plano de reflujo', widthM: 10, heightM: 8 },
      });
      expect(
        creado.ok(),
        `crear el plano de prueba: ${creado.status()} ${await creado.text()}`,
      ).toBe(true);
      const { id } = (await creado.json()) as { id: string };
      try {
        await entrar(page);
        await irA(page, '/coverage', textos.mas);
        const editar = page
          .getByRole('group', { name: textos.vistas })
          .getByRole('button', { name: textos.editar });
        await expect(editar).toBeVisible();
        if ((await editar.getAttribute('aria-pressed')) !== 'true') await editar.click();
        // La barra de herramientas del plano tiene que estar pintada: es lo que se mide.
        await expect(page.getByRole('group', { name: textos.herramientasPlano })).toBeVisible();
        await sinDesborde(page, 'Cobertura');
      } finally {
        await request.delete(`/api/coverage/floorplans/${id}`, { headers: cabeceras });
      }
    });

    test('Automatizaciones cabe', async ({ page }) => {
      await entrar(page);
      await irA(page, '/automations', textos.mas);
      // El dato: la lista ya cargó (sin esqueletos) y el botón de alta del admin está pintado.
      await expect(page.getByRole('button', { name: textos.nuevaAutomatizacion })).toBeVisible();
      await expect(page.locator('.kr-shimmer')).toHaveCount(0);
      await sinDesborde(page, 'Automatizaciones');
    });
  });
}
