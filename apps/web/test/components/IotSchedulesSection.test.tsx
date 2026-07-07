import type { IotDevice, IotSchedule, Scene } from '@krakenos/types';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { IotSchedulesSection } from '@/components/scenes/IotSchedulesSection';
import { Toaster } from '@/components/ui/toast';
import { useToastStore } from '@/store/toast.store';

const LIGHT: IotDevice = {
  id: 'light-salon',
  name: 'Luz salón',
  kind: 'light',
  room: null,
  reachable: true,
  on: true,
  brightness: 80,
  color: null,
  reading: null,
};
const SCENE: Scene = { id: 's1', name: 'Cine', icon: 'movie', actions: [], order: 0, createdAt: '' };

function renderSection() {
  return render(
    <>
      <IotSchedulesSection devices={[LIGHT]} scenes={[SCENE]} isAdmin />
      <Toaster />
    </>,
  );
}

describe('IotSchedulesSection (US-168)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) => {
      if (path === '/iot-schedules') return Promise.resolve([]);
      if (path === '/system/settings') return Promise.resolve({ settings: {} });
      return Promise.resolve([]);
    });
    apiMock.post.mockReset().mockResolvedValue({});
    apiMock.patch.mockReset().mockResolvedValue({});
    useToastStore.setState({ toasts: [] });
  });

  it('lista los horarios con su hora, días y objetivo legibles', async () => {
    const schedule: IotSchedule = {
      id: 'sch1',
      name: 'Riego',
      enabled: true,
      days: [1, 2, 3, 4, 5],
      time: { kind: 'fixed', minute: 7 * 60 },
      target: { type: 'device', deviceId: 'light-salon', on: true },
      createdAt: '',
    };
    apiMock.get.mockImplementation((path: string) =>
      path === '/iot-schedules' ? Promise.resolve([schedule]) : Promise.resolve({ settings: {} }),
    );
    renderSection();
    expect(await screen.findByText('Riego')).toBeInTheDocument();
    expect(screen.getByText(/07:00 · Lun Mar Mié Jue Vie · Luz salón: encender/)).toBeInTheDocument();
  });

  it('crea un horario a hora fija sobre un dispositivo (POST)', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(await screen.findByRole('button', { name: 'Nuevo horario' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nombre'), 'Riego');
    await user.clear(within(dialog).getByLabelText('Hora'));
    await user.type(within(dialog).getByLabelText('Hora'), '07:00');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/iot-schedules',
        expect.objectContaining({
          name: 'Riego',
          time: { kind: 'fixed', minute: 420 },
          target: expect.objectContaining({ type: 'device', deviceId: 'light-salon' }),
        }),
      ),
    );
  });

  it('guarda la ubicación del hogar para el cálculo solar', async () => {
    const user = userEvent.setup();
    renderSection();

    await user.type(await screen.findByLabelText('Latitud'), '40.41');
    await user.type(screen.getByLabelText('Longitud'), '-3.70');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/system/settings', {
        key: 'homeLatitude',
        value: '40.41',
      }),
    );
  });
});
