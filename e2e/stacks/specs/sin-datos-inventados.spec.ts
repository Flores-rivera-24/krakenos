import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { ADMIN, esperarContenido, login, observarProblemas, stackOf } from '../lib/harness.js';
import { KIND_DEL_STACK } from '../lib/stacks.js';

/**
 * Una instalación nueva NO enseña datos inventados.
 *
 * `prod` arranca con el `.env` que escribe `scripts/install.sh` (los ocho dominios `none`):
 * ni un dispositivo, regla, peer, cámara ni aparato IoT que el usuario no haya conectado, y
 * ninguna alerta de algo que no existe (`inventory.unknown_device`, `alarm.sensor_fault`…).
 * `dev` arranca en `mock` —lo que ve quien desarrolla o prueba la demo de Docker— y la app
 * lo **declara**: «Datos de demostración».
 *
 * El nombre `macbook-emilio` y compañía son los del mock (`drivers/mock.driver.ts`): si
 * aparecen en `prod`, el mock se ha colado en una instalación real.
 */

const NOMBRES_DEL_MOCK = ['macbook-emilio', 'raspberrypi', 'chromecast-tv'];

/** Lecturas autenticadas por API: el access token solo vive en memoria, así que se pide aparte. */
async function api(page: Page, ruta: string): Promise<unknown> {
  const login = await page.request.post('/api/auth/login', {
    data: { email: ADMIN.email, password: ADMIN.password },
  });
  const token = ((await login.json()) as { tokens?: { accessToken: string } }).tokens?.accessToken;
  const res = await page.request.get(ruta, { headers: { Authorization: `Bearer ${token ?? ''}` } });
  expect(res.ok(), `${ruta} → ${res.status()}`).toBe(true);
  return res.json();
}

/** Salta el test si este stack no es del tipo que prueba (los dos proyectos corren el mismo fichero). */
function soloEn(kind: 'none' | 'mock', testInfo: TestInfo): void {
  test.skip(KIND_DEL_STACK[stackOf(testInfo)] !== kind, `solo el stack con kind «${kind}»`);
}

test.describe('instalación nueva (prod, como la deja install.sh)', () => {
  test('el agente no sirve ni un dato de demostración', async ({ page }, testInfo) => {
    soloEn('none', testInfo);
    await login(page);
    for (const ruta of [
      '/api/inventory/devices',
      '/api/iot/devices',
      '/api/cameras',
      '/api/firewall/rules',
      '/api/qos/rules',
      '/api/vlans',
      '/api/vpn/peers',
      '/api/dns/blocklist',
      '/api/dns/feeds',
      '/api/wifi/access-points',
      '/api/wifi/networks',
    ]) {
      expect(await api(page, ruta), ruta).toEqual([]);
    }
    const { states } = (await api(page, '/api/integrations/status')) as {
      states: Record<string, string>;
    };
    expect(Object.keys(states)).toHaveLength(8);
    expect(new Set(Object.values(states))).toEqual(new Set(['not-configured']));
    const vpn = (await api(page, '/api/vpn/status')) as { enabled: boolean; peerCount: number };
    expect(vpn).toMatchObject({ enabled: false, peerCount: 0 });
  });

  test('tras un barrido completo no hay ninguna alerta de algo que no existe', async ({
    page,
  }, testInfo) => {
    soloEn('none', testInfo);
    await login(page);
    // El inventario barre al arrancar y cada `scanIntervalSec`; la alarma, cada segundo. Un
    // rato basta para ver las dos si fueran a emitir.
    await page.waitForTimeout(6_000);
    const filas = (await api(page, '/api/audit?limit=200')) as { action: string }[];
    const inventadas = filas
      .map((f) => f.action)
      .filter((a) => /^(inventory|alarm|device)\./.test(a));
    expect(inventadas, 'alertas emitidas sin que exista nada conectado').toEqual([]);
  });

  test('el dashboard no avisa de demostración y la barra dice «Sin configurar»', async ({
    page,
  }, testInfo) => {
    soloEn('none', testInfo);
    const problemas = observarProblemas(page);
    await login(page);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Datos de demostración')).toHaveCount(0);
    await expect(page.getByRole('complementary').getByText('Sin configurar')).toBeVisible();
    expect(problemas.consola, 'excepciones en el dashboard').toEqual([]);
    expect(problemas.respuestasFallidas, 'respuestas 4xx/5xx en el dashboard').toEqual([]);
  });

  test('las páginas de cada dominio dicen «Sin configurar» y enlazan a Conectar, sin culpar al usuario', async ({
    page,
  }, testInfo) => {
    soloEn('none', testInfo);
    const problemas = observarProblemas(page);
    await login(page);
    for (const ruta of [
      '/inventory',
      '/wifi',
      '/traffic',
      '/people',
      '/iot',
      '/energy',
      '/cameras',
      '/vpn',
      '/firewall',
      '/vlans',
      '/qos',
      '/dns',
    ]) {
      await page.getByRole('navigation').locator(`a[href="${ruta}"]`).first().click();
      await page.waitForURL(`**${ruta}`);
      await esperarContenido(page);
      const main = page.getByRole('main');
      await expect(main.getByText('Sin configurar'), ruta).toBeVisible();
      await expect(main.getByRole('link', { name: 'Ir a Conectar' }), ruta).toHaveAttribute(
        'href',
        '/connect',
      );
      const texto = await main.innerText();
      for (const nombre of NOMBRES_DEL_MOCK)
        expect(texto, `${ruta}: ${nombre}`).not.toContain(nombre);
      // El vacío que culpa al usuario de algo que no depende de él.
      expect(texto, ruta).not.toMatch(
        /Sin dispositivos IoT|No tienes dispositivos|Aún no hay reglas/,
      );
    }
    expect(problemas.consola, 'excepciones recorriendo las páginas').toEqual([]);
    expect(problemas.respuestasFallidas, 'respuestas 4xx/5xx recorriendo las páginas').toEqual([]);
  });
});

test.describe('demostración (dev, y la imagen de Docker)', () => {
  test('la app lo declara: aviso permanente en el dashboard y en las páginas, y la barra dice «Demostración»', async ({
    page,
  }, testInfo) => {
    soloEn('mock', testInfo);
    await login(page);
    const main = page.getByRole('main');
    await expect(main.getByText('Datos de demostración')).toBeVisible();
    await expect(page.getByRole('complementary').getByText('Demostración')).toBeVisible();

    for (const ruta of ['/inventory', '/iot', '/cameras', '/dns', '/vpn', '/firewall', '/qos']) {
      await page.getByRole('navigation').locator(`a[href="${ruta}"]`).first().click();
      await page.waitForURL(`**${ruta}`);
      await esperarContenido(page);
      // Exactamente uno: nunca dos avisos a la vez.
      await expect(main.getByText('Datos de demostración'), ruta).toHaveCount(1);
    }
  });
});
