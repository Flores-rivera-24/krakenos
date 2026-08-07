import { expect, test } from '@playwright/test';
import { login, observarProblemas, stackOf } from '../lib/harness.js';

/**
 * El dashboard es la pantalla a la que cae todo el mundo tras iniciar sesión, y
 * monta doce widgets a la vez, cada uno con su propia petición. Se prueba solo
 * (sin navegar a otra ruta después) porque una excepción suya aparecía
 * atribuida a la página siguiente —la que se estuviera abriendo cuando saltaba—
 * y así el fallo no se parecía a su causa.
 */

test('el dashboard se asienta sin excepciones', async ({ page }, testInfo) => {
  const stack = stackOf(testInfo);
  const problemas = observarProblemas(page);

  await login(page);

  // Los widgets resuelven sus peticiones de forma escalonada; el fallo aparecía
  // cuando llegaba la respuesta, no al montar. Se le da tiempo a asentarse.
  await page.waitForLoadState('networkidle');
  await expect
    .poll(() => problemas.consola.length, { timeout: 8_000, intervals: [1_000] })
    .toBeGreaterThanOrEqual(0);

  expect(problemas.consola, `excepciones en el dashboard (${stack})`).toEqual([]);
  expect(problemas.respuestasFallidas, `respuestas 4xx/5xx en el dashboard (${stack})`).toEqual([]);
});
