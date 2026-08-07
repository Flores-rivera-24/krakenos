import { expect, type ConsoleMessage, type Page, type Request, type TestInfo } from '@playwright/test';
import type { StackName } from './stacks.js';

/** Credenciales del admin de cada stack (uno por DB). */
export const ADMIN = {
  homeName: 'Casa Stacks',
  displayName: 'Emilio',
  email: 'stacks-admin@krakenos.test',
  password: 'contrasena-stacks-123',
};

/**
 * Deriva el stack del nombre del proyecto Playwright (`dev`, `dev-setup`,
 * `prod`, `prod-setup`). Los specs son **los mismos** para ambos stacks: lo que
 * cambia es el `baseURL` del proyecto y, en los pocos sitios donde el montaje
 * importa de verdad, esta función.
 */
export function stackOf(testInfo: TestInfo): StackName {
  return testInfo.project.name.startsWith('dev') ? 'dev' : 'prod';
}

/**
 * Rutas de la navegación (`apps/web/src/components/layout/nav.ts`) que ve un
 * admin. Es la lista completa de páginas: el humo las recorre todas porque un
 * fallo de montaje (un chunk que no carga, un import que solo existe en dev) se
 * manifiesta en **una** página y ninguna suite las visitaba todas.
 */
export const ADMIN_ROUTES: { path: string; nav: string }[] = [
  { path: '/', nav: 'Dashboard' },
  { path: '/connect', nav: 'Conectar' },
  { path: '/inventory', nav: 'Dispositivos' },
  { path: '/people', nav: 'Personas' },
  { path: '/rooms', nav: 'Habitaciones' },
  { path: '/scenes', nav: 'Escenas' },
  { path: '/automations', nav: 'Automatizaciones' },
  { path: '/iot', nav: 'IoT' },
  { path: '/energy', nav: 'Energía' },
  { path: '/cameras', nav: 'Cámaras' },
  { path: '/wifi', nav: 'Red WiFi' },
  { path: '/coverage', nav: 'Cobertura WiFi' },
  { path: '/traffic', nav: 'Tráfico' },
  { path: '/vpn', nav: 'VPN' },
  { path: '/firewall', nav: 'Firewall' },
  { path: '/vlans', nav: 'VLANs' },
  { path: '/qos', nav: 'QoS' },
  { path: '/dns', nav: 'DNS' },
  { path: '/settings', nav: 'Ajustes' },
];

/**
 * Ruido conocido de la consola que **no** es un fallo de la app y que, si no se
 * filtra, ahoga la señal. La lista es corta y razonada a propósito: cada entrada
 * que se añada aquí es una regresión que este arnés deja de ver.
 */
const RUIDO_CONSOLA = [
  // React DevTools: sugerencia del propio React en desarrollo.
  'Download the React DevTools',
  // Vite avisa del websocket de HMR al recargar; no afecta a la app.
  '[vite] server connection lost',
  // React Router v6 avisa de banderas de v7. Es deuda anotada, no un fallo de
  // montaje, y solo se emite en desarrollo: dejarlo fallar aquí escondería lo
  // que sí importa detrás de un aviso que sale en todas las páginas.
  'React Router Future Flag Warning',
  /**
   * El navegador emite «Failed to load resource: … 401» por cada 401, y el
   * arranque de la app **siempre** intenta rehidratar la sesión con la cookie de
   * refresh (`store/auth.store.ts`). Sin sesión —pantalla de configuración, de
   * login o tras cerrar sesión— ese 401 es la respuesta correcta, no un fallo.
   * Los 401 que sí importan (una ruta que rechaza a quien debería poder verla)
   * los caza `respuestasFallidas`, que registra la URL.
   */
  'Failed to load resource: the server responded with a status of 401',
];

export interface ProblemasDePagina {
  consola: string[];
  peticiones: string[];
  /** Respuestas HTTP ≥ 400, con su URL (lo que la consola del navegador oculta). */
  respuestasFallidas: string[];
}

/**
 * Engancha a la página los dos observadores que delatan un fallo de montaje:
 * errores de consola (incluidas excepciones no capturadas) y peticiones que
 * fallan a nivel de red. Devuelve el acumulador, que el test asevera al final.
 *
 * ⚠️ Se llama **antes** del primer `goto`: los errores del arranque (un chunk
 * que no carga, el catálogo i18n que no llega) ocurren en el primer render y un
 * observador tardío no los vería.
 */
export function observarProblemas(page: Page): ProblemasDePagina {
  const problemas: ProblemasDePagina = { consola: [], peticiones: [], respuestasFallidas: [] };

  page.on('response', (res) => {
    if (res.status() < 400) return;
    const url = new URL(res.url());
    // El 401 de rehidratación sin sesión es correcto (ver `RUIDO_CONSOLA`).
    if (res.status() === 401 && url.pathname === '/api/auth/refresh') return;
    problemas.respuestasFallidas.push(`${res.status()} ${res.request().method()} ${url.pathname}`);
  });

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() !== 'error' && msg.type() !== 'warning') return;
    const texto = msg.text();
    if (RUIDO_CONSOLA.some((r) => texto.includes(r))) return;
    problemas.consola.push(`[${msg.type()}] ${texto}`);
  });

  // Excepción no capturada: no siempre llega como `console.error`.
  page.on('pageerror', (err) => {
    problemas.consola.push(`[pageerror] ${err.message}`);
  });

  page.on('requestfailed', (req: Request) => {
    // `net::ERR_ABORTED` es lo que ve Playwright cuando la app cancela una
    // petición al desmontar un componente: es comportamiento correcto, no fallo.
    const fallo = req.failure()?.errorText ?? '';
    if (fallo.includes('ERR_ABORTED')) return;
    problemas.peticiones.push(`${req.method()} ${req.url()} → ${fallo}`);
  });

  return problemas;
}

/**
 * Espera a que una página del shell haya **montado su contenido**.
 *
 * No se asevera sobre un encabezado, aunque sería lo natural: la jerarquía de
 * encabezados del proyecto no es uniforme —solo 3 de 19 páginas tienen `<h1>`,
 * la mayoría titula con `<h2>` y `/inventory`, `/people` y `/dns` no tienen
 * **ningún** encabezado— así que un `getByRole('heading')` mediría eso y no lo
 * que aquí importa, que es distinguir «la página montó» de «la ruta cambió y no
 * se pintó nada». Queda anotado como hallazgo de accesibilidad aparte.
 */
export async function esperarContenido(page: Page): Promise<void> {
  const main = page.getByRole('main');
  await expect(main).toBeVisible({ timeout: 25_000 });
  await expect
    .poll(async () => (await main.innerText()).trim().length, {
      message: '<main> quedó vacío: la ruta cambió pero la página no pintó nada',
      timeout: 25_000,
    })
    .toBeGreaterThan(20);
}

/**
 * Enlace de navegación por su `href`, no por su nombre accesible: los elementos
 * con contador (Dispositivos, Firewall, IoT) se llaman «Firewall 2», así que
 * buscarlos por texto exacto no los encuentra y por texto parcial es ambiguo.
 */
export function enlaceDeNav(page: Page, path: string) {
  return page.getByRole('navigation').locator(`a[href="${path}"]`).first();
}

/** Inicia sesión por el formulario (el access token vive solo en memoria). */
export async function login(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Correo electrónico').fill(ADMIN.email);
  await page.getByLabel('Contraseña', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: 'Iniciar sesión' }).click();
  await page.waitForURL('**/');
  await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
}
