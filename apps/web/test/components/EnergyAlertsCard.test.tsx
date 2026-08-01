import type { EnergyAlertRule, IotDevice } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { EnergyAlertsCard } from '@/components/energy/EnergyAlertsCard';
import { Toaster } from '@/components/ui/toast';
import { useToastStore } from '@/store/toast.store';

const DEVICES: IotDevice[] = [
  {
    id: 'plug-tv',
    name: 'TV',
    kind: 'plug',
    room: 'Salón',
    reachable: true,
    on: true,
    brightness: null,
    color: null,
    readings: [],
    powerW: 120,
  },
  {
    id: 'sensor-temp',
    name: 'Temp',
    kind: 'sensor',
    room: 'Salón',
    reachable: true,
    on: null,
    brightness: null,
    color: null,
    readings: [],
  },
];

const RULE: EnergyAlertRule = {
  id: 'a1',
  deviceId: 'plug-tv',
  metric: 'sustained-power',
  threshold: 500,
  sustainMinutes: 5,
  enabled: true,
  createdAt: '',
};

function renderCard() {
  return render(
    <>
      <EnergyAlertsCard />
      <Toaster />
    </>,
  );
}

describe('EnergyAlertsCard (US-183)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) => {
      if (path === '/energy/alerts') return Promise.resolve([RULE]);
      if (path === '/iot/devices') return Promise.resolve(DEVICES);
      return Promise.resolve([]);
    });
    apiMock.post.mockReset();
    apiMock.del.mockReset().mockResolvedValue(undefined);
    useToastStore.setState({ toasts: [] });
  });

  it('lista las reglas existentes con nombre y descripción', async () => {
    renderCard();
    expect(await screen.findByText(/más de 500 W durante 5 min/)).toBeInTheDocument();
    // El nombre del dispositivo aparece (en la fila de la regla y en el select).
    expect(screen.getAllByText('TV').length).toBeGreaterThan(0);
  });

  it('solo ofrece dispositivos controlables (sin sensores)', async () => {
    renderCard();
    await screen.findByText(/más de 500 W/);
    // El select de dispositivo no incluye el sensor.
    expect(screen.queryByRole('option', { name: 'Temp' })).not.toBeInTheDocument();
  });

  it('crea una alerta de potencia sostenida', async () => {
    apiMock.post.mockResolvedValue({ ...RULE, id: 'a2', threshold: 800 });
    renderCard();
    const user = userEvent.setup();
    await screen.findByText(/más de 500 W/);
    const threshold = screen.getByLabelText('Umbral');
    await user.type(threshold, '800');
    await user.click(screen.getByRole('button', { name: 'Añadir' }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/energy/alerts',
        expect.objectContaining({ deviceId: 'plug-tv', metric: 'sustained-power', threshold: 800 }),
      ),
    );
  });

  it('borra una regla', async () => {
    renderCard();
    const user = userEvent.setup();
    await screen.findByText(/más de 500 W/);
    await user.click(screen.getByRole('button', { name: 'Eliminar alerta' }));
    await waitFor(() => expect(apiMock.del).toHaveBeenCalledWith('/energy/alerts/a1'));
  });
});
