import type { EnergyConfig, EnergyStats } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)), post: vi.fn(), patch: vi.fn(), put: vi.fn() };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { EnergyPage } from '@/pages/EnergyPage';
import { Toaster } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';

function stats(over: Partial<EnergyStats> = {}): EnergyStats {
  return {
    range: 'day',
    buckets: [{ timestamp: '2026-07-10T10:00:00.000Z', powerW: 100, energyWh: 100 }],
    totalEnergyWh: 1500,
    previousTotalEnergyWh: 1000,
    pricePerKwh: 0.15,
    currency: '€',
    totalCost: 0.23,
    previousTotalCost: 0.15,
    devices: [
      {
        deviceId: 'plug-tv',
        name: 'TV',
        room: 'Salón',
        energyWh: 1500,
        cost: 0.23,
        buckets: [],
      },
    ],
    ...over,
  };
}

const config: EnergyConfig = { pricePerKwh: 0.15, currency: '€' };

function asRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'A', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <EnergyPage />
      <Toaster />
    </MemoryRouter>,
  );
}

describe('EnergyPage (US-182)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) => {
      if (path.startsWith('/energy/stats')) return Promise.resolve(stats());
      if (path === '/energy/config') return Promise.resolve(config);
      if (path === '/energy/alerts') return Promise.resolve([]);
      if (path === '/iot/devices') return Promise.resolve([]);
      return Promise.resolve({});
    });
    apiMock.put.mockReset().mockResolvedValue(config);
    useToastStore.setState({ toasts: [] });
    asRole('admin');
  });

  it('muestra el consumo total, coste y desglose por dispositivo', async () => {
    renderPage();
    // Total y el único dispositivo comparten valor (1.5 kWh): ≥1 aparición.
    expect((await screen.findAllByText('1.50 kWh')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('0.23 €').length).toBeGreaterThan(0); // coste
    expect(screen.getByText('TV')).toBeInTheDocument();
    expect(screen.getByText('+50%')).toBeInTheDocument(); // vs anterior
  });

  it('un admin ve el formulario de precio y lo guarda', async () => {
    apiMock.put.mockResolvedValue({ pricePerKwh: 0.2, currency: '€' });
    renderPage();
    const user = userEvent.setup();
    const priceInput = await screen.findByLabelText('Precio por kWh');
    // Espera a que la config cargada esté aplicada antes de teclear: si no, el
    // setPrice tardío del efecto re-renderiza en mitad de la interacción y el
    // click puede caer en un nodo obsoleto (flaky bajo carga).
    await waitFor(() => expect(priceInput).toHaveValue(0.15));
    await user.clear(priceInput);
    await user.type(priceInput, '0.2');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    await waitFor(() =>
      expect(apiMock.put).toHaveBeenCalledWith('/energy/config', {
        pricePerKwh: 0.2,
        currency: '€',
      }),
    );
  });

  it('un viewer no ve el formulario de precio', async () => {
    asRole('viewer');
    renderPage();
    await screen.findByText('TV');
    expect(screen.queryByLabelText('Precio por kWh')).not.toBeInTheDocument();
  });

  it('muestra el estado vacío sin dispositivos', async () => {
    apiMock.get.mockImplementation((path: string) => {
      if (path.startsWith('/energy/stats'))
        return Promise.resolve(stats({ devices: [], totalEnergyWh: 0, buckets: [] }));
      if (path === '/energy/config') return Promise.resolve(config);
      return Promise.resolve({});
    });
    renderPage();
    expect(await screen.findByText(/Ningún dispositivo reporta consumo/)).toBeInTheDocument();
  });
});
