import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));
const fakeSocket = vi.hoisted(() => ({ connected: true, on: vi.fn(), off: vi.fn(), emit: vi.fn() }));
vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));

import { DashboardPage } from '@/pages/DashboardPage';
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

  it('renderiza los widgets por defecto', () => {
    renderDashboard();
    expect(screen.getByText('Dispositivos')).toBeInTheDocument();
    expect(screen.getByText('Sistema')).toBeInTheDocument();
    expect(screen.getByText('Tráfico WAN')).toBeInTheDocument();
    expect(screen.getByText('Topología de red')).toBeInTheDocument();
    expect(screen.getByText('Alertas recientes')).toBeInTheDocument();
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
