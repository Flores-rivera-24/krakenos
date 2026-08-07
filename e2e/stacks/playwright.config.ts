import { defineConfig, devices } from '@playwright/test';
import { BASE_URL } from './lib/stacks.js';

/**
 * Suite de **verificación de montaje**: los mismos flujos contra `pnpm dev` y
 * `pnpm prod`. El porqué y las diferencias con el arnés de US-189 están en
 * `lib/stacks.ts`; la guía de uso, en `docs/e2e-stacks.md`.
 *
 * Un proyecto por stack, cada uno con su proyecto de `setup` (cada stack tiene
 * su propia base de datos, así que cada uno necesita crear su propio admin).
 */
export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  // Los dos stacks comparten la máquina y cada uno tiene una sola DB: en serie.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: './playwright-report' }]],
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  // Vite compila bajo demanda la primera vez que se pide una ruta: la primera
  // navegación de cada página en dev es notablemente más lenta que en prod.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    // Igual que en US-189: la app detecta el idioma del navegador y la suite
    // asevera el copy en español, que es la fuente canónica.
    locale: 'es-ES',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'dev-setup',
      testMatch: /setup\/admin\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: BASE_URL.dev },
    },
    {
      name: 'dev',
      testDir: './specs',
      dependencies: ['dev-setup'],
      use: { ...devices['Desktop Chrome'], baseURL: BASE_URL.dev },
    },
    {
      name: 'prod-setup',
      testMatch: /setup\/admin\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: BASE_URL.prod },
    },
    {
      name: 'prod',
      testDir: './specs',
      dependencies: ['prod-setup'],
      use: { ...devices['Desktop Chrome'], baseURL: BASE_URL.prod },
    },
  ],
});
