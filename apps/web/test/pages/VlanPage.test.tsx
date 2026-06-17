import type { Device, VlanWithCount } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { VlanPage } from '@/pages/VlanPage';
import { useAuthStore } from '@/store/auth.store';

const VLAN: VlanWithCount = {
  id: 'vl1',
  tag: 30,
  name: 'IoT',
  subnet: '10.0.30.0/24',
  isolated: true,
  createdAt: '2026-06-17T00:00:00.000Z',
  deviceCount: 1,
};

const DEVICE: Device = {
  id: 'd1',
  mac: 'aa:bb:cc:dd:ee:01',
  ip: '10.0.0.5',
  hostname: 'cam',
  label: 'Cámara salón',
  notes: null,
  vendor: null,
  type: 'iot',
  isBlocked: false,
  online: true,
  vlanTag: null,
  sources: ['arp'],
  firstSeen: '2026-06-17T00:00:00.000Z',
  lastSeen: '2026-06-17T00:00:00.000Z',
};

function setRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'Emilio', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

describe('VlanPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) =>
      Promise.resolve(path === '/vlans' ? [VLAN] : [DEVICE]),
    );
    apiMock.post.mockReset().mockResolvedValue(VLAN);
    apiMock.put.mockReset().mockResolvedValue(DEVICE);
    apiMock.del.mockReset().mockResolvedValue(undefined);
    setRole('admin');
  });

  it('muestra las VLANs con su subred y conteo, y los dispositivos', async () => {
    render(<VlanPage />);
    await waitFor(() => expect(screen.getByText('IoT')).toBeInTheDocument());
    expect(screen.getByText('10.0.30.0/24')).toBeInTheDocument();
    expect(screen.getByText('1 dispositivos')).toBeInTheDocument();
    expect(screen.getByText('Cámara salón')).toBeInTheDocument();
  });

  it('crea una VLAN con el formulario (admin)', async () => {
    render(<VlanPage />);
    await screen.findByText('IoT');

    await userEvent.type(screen.getByLabelText('Tag (1-4094)'), '50');
    await userEvent.type(screen.getByLabelText('Nombre'), 'Cámaras');
    await userEvent.click(screen.getByRole('button', { name: /Crear VLAN/ }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/vlans',
        expect.objectContaining({ tag: 50, name: 'Cámaras' }),
      ),
    );
  });

  it('asigna un dispositivo a una VLAN con el selector', async () => {
    render(<VlanPage />);
    await screen.findByText('Cámara salón');

    await userEvent.selectOptions(screen.getByLabelText(/VLAN de/), '30');
    await waitFor(() =>
      expect(apiMock.put).toHaveBeenCalledWith('/inventory/devices/d1/vlan', { tag: 30 }),
    );
  });

  it('un viewer no ve el formulario y no puede reasignar', async () => {
    setRole('viewer');
    render(<VlanPage />);
    await screen.findByText('Cámara salón');
    expect(screen.queryByText('Nueva VLAN')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/VLAN de/)).toBeDisabled();
  });
});
