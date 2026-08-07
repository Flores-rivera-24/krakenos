import { expect, test } from '@playwright/test';
import { login, stackOf } from '../lib/harness.js';

/**
 * Socket.io en cada montaje.
 *
 * En `pnpm prod` el websocket va directo al agente. En `pnpm dev` atraviesa el
 * **proxy de Vite** (`server.proxy['/socket.io'].ws = true`, `vite.config.ts`),
 * que es una pieza que ninguna suite ejercitaba: el arnés de US-189 sirve la web
 * desde el propio agente, así que allí el proxy no existe. Un fallo aquí deja el
 * dashboard sin datos en vivo **solo en desarrollo**, que es donde se trabaja.
 */

test('el websocket se establece y el servidor empuja datos', async ({ page }, testInfo) => {
  const stack = stackOf(testInfo);

  // Se engancha antes del login: el socket se abre en cuanto hay sesión.
  const sockets: string[] = [];
  const recibido: string[] = [];
  page.on('websocket', (ws) => {
    sockets.push(ws.url());
    ws.on('framereceived', (f) => {
      if (typeof f.payload === 'string') recibido.push(f.payload);
    });
  });

  await login(page);

  await expect
    .poll(() => sockets.filter((u) => u.includes('/socket.io/')).length, {
      message: `no se abrió ningún websocket de Socket.io en ${stack}`,
      timeout: 20_000,
    })
    .toBeGreaterThan(0);

  // Abrirse no basta: el handshake exige un access token válido (`io.use`), así
  // que un socket que se abre y se cierra en seco es indistinguible a simple
  // vista de uno que funciona. Lo que prueba que la sesión pasó el handshake es
  // recibir un mensaje del servidor.
  await expect
    .poll(() => recibido.length, {
      message: `el websocket se abrió pero el servidor no empujó nada en ${stack}`,
      timeout: 30_000,
    })
    .toBeGreaterThan(0);
});

test('el indicador de conexión no se queda en «desconectado»', async ({ page }, testInfo) => {
  const stack = stackOf(testInfo);
  await login(page);

  // La UI dice si el tiempo real está vivo; si el proxy de ws falla, se queda
  // colgado en desconectado y el usuario ve datos congelados sin saber por qué.
  const desconectado = page.getByText(/Desconectado|Sin conexión/i).first();
  await expect(desconectado, `el indicador quedó en desconectado en ${stack}`).toBeHidden({
    timeout: 20_000,
  });
});
