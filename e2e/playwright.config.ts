import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './lib/server.js';

/**
 * Suite e2e de navegador (US-189). Corre contra la app **construida** servida por
 * el agente con managers mock (ver `lib/server.ts`). El servidor lo gestiona
 * `globalSetup`/`globalTeardown` (no el `webServer` de Playwright) porque hay que
 * **capturar el token de configuración out-of-band** de su salida.
 *
 * Flaky-policy: `retries: 1` (un reintento) en CI; los flujos que aún no aplican
 * (2FA con virtual authenticator, escenas de US-166) están en **cuarentena
 * explícita** con `test.fixme` y motivo — ver `docs/e2e.md`.
 */
export default defineConfig({
  testDir: '.',
  // Artefactos bajo e2e/ (coinciden con e2e/.gitignore y el job de CI).
  outputDir: './test-results',
  // Los flujos comparten una sola DB (setup→login→…): orden y un worker.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]]
    : 'list',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    // La suite asevera la UI en ESPAÑOL (fuente canónica del copy). Sin esto,
    // Chromium arranca en en-US y la detección de idioma (US-177,
    // `resolveInitialLocale`) renderiza la app en inglés → todos los selectores
    // fallan (rompió CI desde la base i18n hasta este fix).
    locale: 'es-ES',
    // Trazas + screenshots/vídeo como artefactos SOLO al fallar (o en reintento).
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // El proyecto `setup` crea el admin (flujo de configuración) y guarda el estado.
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    // El resto corre tras el setup (la cuenta admin ya existe) y hace login por UI.
    {
      name: 'chromium',
      testDir: './tests',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
