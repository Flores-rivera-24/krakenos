import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Gate: abrir el dashboard no pide dos veces lo mismo (US-262).
 *
 * Medido antes de la historia, con la barra lateral en pantalla: **20 peticiones**
 * al abrir, de las cuales `/iot/devices` **×3** (`QuickActionsWidget`,
 * `IotStatusWidget` y la barra lateral), `/scenes` **×2** y `/system/stats` **×2**.
 * Cada widget traía su `useEffect`, su `useState` y su `catch`, y ninguno sabía de
 * los otros — así que el agente, que corre en una Raspberry sobre microSD,
 * contestaba tres veces lo mismo en el mismo tick.
 *
 * Lo que se vigila aquí es **la repetición**, no el total: el total sube
 * legítimamente cuando alguien añade un widget con datos propios, y un umbral
 * sobre él se acabaría subiendo sin pensar. Que una ruta se pida dos veces en el
 * mismo arranque, en cambio, no tiene ninguna lectura inocente.
 */

const apiMock = vi.hoisted(() => {
  const get = vi.fn();
  return {
    get,
    getList: vi.fn((path: string) => get(path)),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));
const fakeSocket = vi.hoisted(() => ({
  connected: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));

import { AppSidebar } from '@/components/layout/AppSidebar';
import { DashboardPage } from '@/pages/DashboardPage';
import { useAuthStore } from '@/store/auth.store';
import { useInventoryStore } from '@/store/inventory.store';

const STATS = {
  uptimeSeconds: 3600,
  cpu: { cores: 4, loadPercent: 20 },
  memory: { totalBytes: 8 * 1024 ** 3, usedBytes: 4 * 1024 ** 3, usedPercent: 50 },
  timestamp: '',
};

/** Abre la pantalla tal como la ve un admin en escritorio: barra lateral + dashboard. */
async function abrirDashboard(): Promise<string[]> {
  render(
    <MemoryRouter>
      <AppSidebar collapsed={false} onToggle={() => {}} />
      <DashboardPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(apiMock.get.mock.calls.length).toBeGreaterThan(0));
  // Los widgets pesados son `lazy()` (US-239) y montan un tick más tarde: sin
  // esperarlos, el gate mediría media pantalla y pasaría por no haber mirado.
  await new Promise((r) => setTimeout(r, 400));
  return apiMock.get.mock.calls.map((c) => String(c[0]));
}

describe('peticiones al abrir el dashboard', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({
      user: {
        id: 'u1',
        email: 'a@b.c',
        displayName: 'A',
        role: 'admin',
        uiMode: 'advanced',
      } as never,
    });
    useInventoryStore.setState({ devices: {}, connected: true, recentEvents: [] });
    apiMock.get.mockReset().mockImplementation((path: string) => {
      if (path === '/system/stats') return Promise.resolve(STATS);
      if (path === '/alarm') return Promise.resolve({ state: 'disarmed' });
      if (path === '/presence') return Promise.resolve({ mode: 'home', people: [] });
      return Promise.resolve([]);
    });
  });

  it('ninguna ruta se pide más de una vez', async () => {
    const rutas = await abrirDashboard();

    const repetidas = [...new Map(rutas.map((r) => [r, rutas.filter((x) => x === r).length]))]
      .filter(([, n]) => n > 1)
      .map(([ruta, n]) => `${ruta} ×${n}`);

    expect(repetidas).toEqual([]);
  });

  it('las tres rutas que se duplicaban se piden UNA vez', async () => {
    const rutas = await abrirDashboard();
    const veces = (ruta: string) => rutas.filter((r) => r === ruta).length;

    // Éstas son las que medía la historia: 3, 2 y 2 respectivamente.
    expect(veces('/iot/devices')).toBe(1);
    expect(veces('/scenes')).toBe(1);
    expect(veces('/system/stats')).toBe(1);
  });

  it('el gate está mirando una pantalla de verdad, no una vacía', async () => {
    const rutas = await abrirDashboard();
    // Sin este guard, un fallo de montaje dejaría la lista casi vacía y los dos
    // tests de arriba pasarían **sin haber comprobado nada**: «no encontré
    // peticiones» no puede leerse como «no hay duplicados».
    expect(new Set(rutas).size).toBeGreaterThan(10);
  });
});
