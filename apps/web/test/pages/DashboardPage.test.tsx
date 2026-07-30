import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));
const fakeSocket = vi.hoisted(() => ({ connected: true, on: vi.fn(), off: vi.fn(), emit: vi.fn() }));
vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));

import { DashboardPage } from '@/pages/DashboardPage';
import { useAuthStore } from '@/store/auth.store';
import { useInventoryStore } from '@/store/inventory.store';

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe('DashboardPage', () => {
  const STATS = {
    uptimeSeconds: 3600,
    cpu: { cores: 4, loadPercent: 20 },
    memory: { totalBytes: 8 * 1024 ** 3, usedBytes: 4 * 1024 ** 3, usedPercent: 50 },
    timestamp: '',
  };

  beforeEach(() => {
    localStorage.clear();
    // El rol se arrastraría entre tests (el store es singleton) y el filtrado de
    // widgets de US-239 depende de él.
    useAuthStore.setState({ user: null });
    useInventoryStore.setState({ devices: {}, connected: true, recentEvents: [] });
    apiMock.get
      .mockReset()
      .mockImplementation((path: string) =>
        path === '/system/stats' ? Promise.resolve(STATS) : Promise.resolve([]),
      );
  });

  it('muestra el título y el estado de conexión en tiempo real', () => {
    renderDashboard();
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('En tiempo real · conectado')).toBeInTheDocument();
  });

  it('renderiza los widgets por defecto', async () => {
    renderDashboard();
    expect(screen.getByText('Dispositivos')).toBeInTheDocument();
    expect(screen.getByText('Sistema')).toBeInTheDocument();
    expect(screen.getByText('Alertas recientes')).toBeInTheDocument();
    // US-239: Tráfico y Topología son `lazy()` (Recharts son 98,7 kB que ya no
    // viajan en el chunk del dashboard), así que llegan en un tick posterior.
    expect(await screen.findByText('Tráfico WAN')).toBeInTheDocument();
    expect(await screen.findByText('Topología de red')).toBeInTheDocument();
  });

  /**
   * US-239 (AUD3-28): el dashboard ignoraba el rol y el modo sencillo — los 12
   * widgets se renderizaban para todos, así que un `kid` aterrizaba en CPU, RAM,
   * uptime, topología y tráfico WAN, justo lo que el modo sencillo oculta en la
   * barra lateral de esa misma sesión.
   */
  it('un `kid` no ve los widgets de red avanzada', async () => {
    useAuthStore.setState({
      user: { id: 'u2', email: 'k@b.c', displayName: 'K', role: 'kid', uiMode: 'advanced' } as never,
    });
    renderDashboard();

    // Lo suyo sí.
    expect(screen.getByText('Dispositivos')).toBeInTheDocument();
    // Lo de operar la red, no.
    expect(screen.queryByText('Sistema')).toBeNull();
    expect(screen.queryByText('Tráfico WAN')).toBeNull();
    expect(screen.queryByText('Topología de red')).toBeNull();
    expect(screen.queryByText('Alertas recientes')).toBeNull();
  });

  it('el modo sencillo oculta lo avanzado aunque el rol sea admin', () => {
    useAuthStore.setState({
      user: { id: 'u3', email: 'a@b.c', displayName: 'A', role: 'admin', uiMode: 'simple' } as never,
    });
    renderDashboard();

    expect(screen.getByText('Dispositivos')).toBeInTheDocument();
    expect(screen.queryByText('Tráfico WAN')).toBeNull();
  });

  it('el modo Personalizar muestra los controles de orden/visibilidad', async () => {
    const user = userEvent.setup();
    renderDashboard();
    expect(screen.queryByLabelText(/Subir/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Personalizar/ }));
    expect(screen.getAllByLabelText(/Subir/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Hecho/ })).toBeInTheDocument();
  });

  it('ocultar un widget lo quita del dashboard y persiste', async () => {
    const user = userEvent.setup();
    renderDashboard();
    await user.click(screen.getByRole('button', { name: /Personalizar/ }));
    await user.click(screen.getByLabelText('Ocultar IoT'));
    // Vuelve al modo normal: el widget IoT ya no aparece.
    await user.click(screen.getByRole('button', { name: /Hecho/ }));
    await waitFor(() => expect(screen.queryByText('IoT')).not.toBeInTheDocument());
    expect(localStorage.getItem('krakenos-dashboard-layout')).toContain('iot');
  });
});
