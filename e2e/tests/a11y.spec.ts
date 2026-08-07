import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { login } from '../lib/auth.js';

/**
 * Accesibilidad **en navegador real** (WCAG 2.1 AA).
 *
 * Qué añade sobre lo que ya había. `apps/web/test/a11y/pages.a11y.test.tsx` pasa
 * axe sobre páginas montadas en **jsdom**, y eso deja fuera justo lo que rompe la
 * accesibilidad en la práctica: jsdom no calcula estilos en cascada, así que **no
 * puede medir contraste**; no tiene layout, así que no ve solapamientos ni
 * objetivos táctiles; y cada página se monta suelta, sin el layout de la app, así
 * que las reglas de landmarks y de orden de encabezados se desactivan para evitar
 * falsos positivos. Aquí la app corre entera y de verdad, con su CSS aplicado.
 *
 * Se comprueba la app **navegada como la usa una persona** (enlaces de la barra
 * lateral), no con `page.goto`: el access token vive en memoria (US-91) y una
 * recarga cerraría la sesión.
 */

/** Reglas WCAG 2.0/2.1 nivel A y AA — el mismo alcance que la suite de jsdom. */
const ETIQUETAS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/**
 * Páginas del menú principal. Se nombran por su enlace visible porque es
 * exactamente lo que pulsa el usuario; si alguien renombra el enlace y olvida la
 * traducción, este test se entera antes que nadie.
 */
const PAGINAS = [
  'Dashboard',
  'Dispositivos',
  'Habitaciones',
  'Escenas',
  'Personas',
  'Red WiFi',
  'Ajustes',
];

test.beforeEach(async ({ page }) => {
  await login(page);
});

/**
 * Espera a que la página esté **pintada de verdad** antes de medir.
 *
 * No es una precaución de manual: sin ella, axe analiza la pantalla a medio
 * renderizar y **inventa violaciones de contraste**. Los esqueletos de carga
 * (`.kr-shimmer`) pintan un degradado animado donde luego va el texto, así que
 * axe compone el color del texto contra un fondo que en un instante ya no
 * existe, y publica ratios como 4,28:1 sobre colores que el usuario nunca ve.
 * Es el mismo error que cometía el medidor de la paleta antes de US-231, solo
 * que al revés: allí un falso ✅, aquí un falso ✗. Las dos mentiras cuestan lo
 * mismo, porque un test que grita sin motivo se acaba ignorando.
 */
async function esperarPintado(page: Page): Promise<void> {
  // Ancla en el landmark `main`, no en un encabezado: no todas las páginas
  // tienen `<h1>`–`<h6>` (Dispositivos, por ejemplo, titula con un párrafo), y
  // anclarse en algo que no existe convierte el test en un timeout que parece
  // un fallo de accesibilidad sin serlo.
  await expect(page.getByRole('main')).toBeVisible();
  // Ni un solo esqueleto en pantalla: mientras haya, hay texto sin su fondo final.
  await expect(page.locator('.kr-shimmer')).toHaveCount(0, { timeout: 15_000 });
  // Y ninguna animación de entrada a medias (opacidad/transform en curso).
  await page.waitForFunction(
    () => document.getAnimations().every((a) => a.playState !== 'running'),
    undefined,
    { timeout: 15_000 },
  );
}

for (const enlace of PAGINAS) {
  test(`a11y: «${enlace}» no tiene violaciones WCAG A/AA`, async ({ page }) => {
    await page.getByRole('link', { name: enlace }).first().click();
    await esperarPintado(page);

    const { violations } = await new AxeBuilder({ page })
      .withTags(ETIQUETAS_WCAG)
      .analyze();

    // El mensaje lleva regla + nodos: un fallo tiene que decir QUÉ arreglar sin
    // volver a ejecutar nada.
    const detalle = violations.map(
      (v) => `[${v.id}] ${v.help} (${v.nodes.length} nodo/s) → ${v.nodes[0]?.target.join(' ')}`,
    );
    expect(detalle).toEqual([]);
  });
}

/**
 * El contraste es la razón principal por la que esta suite existe: es la única
 * regla WCAG que jsdom **no puede** evaluar (no hay cascada de estilos), y el
 * proyecto ya se llevó un susto con ella —hasta US-231 el medidor de la paleta
 * leía `:root` mientras la app renderiza con `<html class="dark">`, y publicaba
 * ✅ sobre colores que el usuario no veía—. Aquí se mide sobre el DOM pintado.
 */
test('a11y: contraste real en el tema que ve el usuario', async ({ page }) => {
  const { violations } = await new AxeBuilder({ page })
    .withTags(ETIQUETAS_WCAG)
    .withRules(['color-contrast'])
    .analyze();

  const detalle = violations.flatMap((v) =>
    v.nodes.map((n) => `${n.target.join(' ')} → ${n.failureSummary?.split('\n')[1]?.trim()}`),
  );
  expect(detalle).toEqual([]);
});
