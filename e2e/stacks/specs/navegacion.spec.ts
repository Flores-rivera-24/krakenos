import { expect, test } from '@playwright/test';
import {
  ADMIN_ROUTES,
  enlaceDeNav,
  esperarContenido,
  login,
  observarProblemas,
  stackOf,
} from '../lib/harness.js';

/**
 * Recorre **todas** las páginas del admin de dos formas distintas, porque fallan
 * por motivos distintos:
 *
 *  1. **Navegando por el menú** (client-side): es lo que hace una persona con la
 *     sesión ya abierta. Aquí se ven los chunks perezosos que no cargan y los
 *     errores de render.
 *  2. **Entrando directo a la URL** (recarga completa): es lo que hace un
 *     marcador, un F5 o un enlace compartido. Aquí se ve si la sesión se
 *     rehidrata con la cookie de refresh y si el servidor sabe servir el SPA en
 *     rutas profundas — que en `pnpm prod` lo sirve el agente y en `pnpm dev` lo
 *     sirve Vite, o sea **dos implementaciones distintas del mismo contrato**.
 *
 * Ninguna suite del proyecto recorría las 19 páginas ni probaba la entrada
 * directa: el arnés de US-189 navega siempre client-side (`docs/e2e.md`).
 */

test.describe('navegación por el menú', () => {
  test('las 19 páginas del admin cargan sin errores', async ({ page }, testInfo) => {
    const stack = stackOf(testInfo);
    const problemas = observarProblemas(page);
    await login(page);

    const fallos: string[] = [];
    for (const ruta of ADMIN_ROUTES) {
      if (ruta.path === '/') continue; // ya estamos en el dashboard tras el login
      await enlaceDeNav(page, ruta.path).click();
      await page.waitForURL(`**${ruta.path}`);
      try {
        await esperarContenido(page);
      } catch {
        fallos.push(`${ruta.path}: la ruta cambió pero no se pintó contenido (${stack})`);
      }
    }

    expect(fallos, 'páginas que no montaron').toEqual([]);
    expect(problemas.consola, `errores de consola recorriendo el menú (${stack})`).toEqual([]);
    expect(problemas.peticiones, `peticiones caídas recorriendo el menú (${stack})`).toEqual([]);
    expect(problemas.respuestasFallidas, `respuestas 4xx/5xx en el menú (${stack})`).toEqual([]);
  });
});

test.describe('entrada directa por URL', () => {
  for (const ruta of ADMIN_ROUTES) {
    test(`${ruta.path} se puede abrir en frío`, async ({ page }, testInfo) => {
      const stack = stackOf(testInfo);
      const problemas = observarProblemas(page);

      // Sesión abierta y **recarga completa** en la ruta: el access token vive
      // solo en memoria (US-91), así que esto ejerce la rehidratación por cookie.
      await login(page);
      await page.goto(ruta.path);

      // No debe rebotar al login: la cookie de refresh tiene que bastar.
      await expect(page).toHaveURL(new RegExp(`${ruta.path.replace('/', '\\/')}$`));
      await esperarContenido(page);

      expect(problemas.consola, `errores de consola en ${ruta.path} (${stack})`).toEqual([]);
      expect(problemas.peticiones, `peticiones caídas en ${ruta.path} (${stack})`).toEqual([]);
      expect(
        problemas.respuestasFallidas,
        `respuestas 4xx/5xx en ${ruta.path} (${stack})`,
      ).toEqual([]);
    });
  }
});
