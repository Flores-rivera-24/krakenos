import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// El layout cablea el indicador de conexión (US-94) → socket falso para evitar
// abrir un socket real en jsdom.
const fakeSocket = vi.hoisted(() => ({
  connected: true,
  active: true,
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  io: { on: vi.fn(), off: vi.fn() },
}));
vi.mock('@/lib/socket', () => ({ getSocket: () => fakeSocket }));

import { AppLayout } from '@/components/layout/AppLayout';
import { useAuthStore } from '@/store/auth.store';

const logout = vi.fn();

function renderLayout() {
  return render(
    <MemoryRouter>
      <AppLayout />
    </MemoryRouter>,
  );
}

describe('AppLayout', () => {
  beforeEach(() => {
    logout.mockReset();
    useAuthStore.setState({
      user: {
        id: 'u',
        email: 'a@b.c',
        displayName: 'Emilio',
        role: 'admin',
        createdAt: '',
        updatedAt: '',
      },
      tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
      logout,
    });
  });

  it('muestra la marca y el nombre del usuario', () => {
    renderLayout();
    expect(screen.getAllByText('KrakenOS').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Emilio')).toBeInTheDocument();
  });

  it('renderiza todas las secciones navegables', () => {
    renderLayout();
    for (const label of [
      'Dashboard',
      'Dispositivos',
      'Red WiFi',
      'VPN',
      'Tráfico',
      'IoT',
      'Cámaras',
      'Firewall',
      'VLANs',
      'QoS',
      'DNS',
      'Ajustes',
    ]) {
      // Cada sección aparece en el sidebar y en la bottom-nav.
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it('Firewall enlaza a su ruta (ya no es una sección futura)', () => {
    renderLayout();
    const links = screen.getAllByRole('link', { name: /Firewall/ });
    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]).toHaveAttribute('href', '/firewall');
    expect(screen.queryByText('Próximamente')).not.toBeInTheDocument();
  });

  it('el botón Salir invoca logout', async () => {
    const user = userEvent.setup();
    renderLayout();
    await user.click(screen.getAllByRole('button', { name: 'Salir' })[0]!);
    expect(logout).toHaveBeenCalledOnce();
  });
});
