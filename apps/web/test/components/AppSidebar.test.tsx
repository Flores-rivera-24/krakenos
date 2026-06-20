import type { Device } from '@krakenos/types';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `ThemeToggle` (US-44) usa lib/theme; lo mockeamos para aislar el sidebar.
const themeMock = vi.hoisted(() => ({
  getTheme: vi.fn(() => 'dark'),
  toggleTheme: vi.fn(() => 'light'),
  applyTheme: vi.fn(),
}));
vi.mock('@/lib/theme', () => themeMock);

import { AppSidebar } from '@/components/layout/AppSidebar';
import type { SidebarStats } from '@/lib/sidebar-stats';
import { useAuthStore } from '@/store/auth.store';
import { useInventoryStore } from '@/store/inventory.store';

const STATS: SidebarStats = {
  driver: 'openwrt',
  online: true,
  uptimeSeconds: 3600,
  firewallActive: 0,
  iotOffline: 0,
};

function device(over: Partial<Device>): Device {
  return {
    id: 'd1',
    mac: 'aa:bb:cc:dd:ee:ff',
    ip: '192.168.1.10',
    hostname: null,
    label: null,
    notes: null,
    vendor: null,
    type: 'computer',
    isBlocked: false,
    online: true,
    vlanTag: null,
    sources: ['arp'],
    firstSeen: '',
    lastSeen: '',
    ...over,
  };
}

function renderSidebar(props: { collapsed: boolean; stats?: SidebarStats }) {
  return render(
    <MemoryRouter>
      <AppSidebar
        collapsed={props.collapsed}
        onToggle={vi.fn()}
        stats={props.stats ?? STATS}
      />
    </MemoryRouter>,
  );
}

describe('AppSidebar', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: { id: 'u', email: 'a@b.c', displayName: 'Emilio Flores', role: 'admin', createdAt: '', updatedAt: '' },
      logout: vi.fn(),
    });
    useInventoryStore.setState({ devices: {} });
  });

  it('expandida muestra marca, labels y estado del driver', () => {
    renderSidebar({ collapsed: false });
    expect(screen.getByText('KrakenOS')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Ajustes')).toBeInTheDocument();
    // Estado del driver en la zona inferior.
    expect(screen.getByText('openwrt')).toBeInTheDocument();
  });

  it('colapsada oculta marca y labels pero conserva los iconos/enlaces', () => {
    const { container } = renderSidebar({ collapsed: true });
    expect(screen.queryByText('KrakenOS')).not.toBeInTheDocument();
    expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
    const aside = container.querySelector('aside');
    expect(aside).toHaveAttribute('data-collapsed', 'true');
    // Los enlaces siguen presentes (navegables por icono).
    expect(container.querySelector('a[href="/"]')).toBeInTheDocument();
    expect(container.querySelector('a[href="/settings"]')).toBeInTheDocument();
  });

  it('muestra el badge de "Dispositivos" cuando hay desconocidos o bloqueados', () => {
    useInventoryStore.setState({
      devices: {
        d1: device({ id: 'd1', type: 'unknown' }),
        d2: device({ id: 'd2', isBlocked: true }),
        d3: device({ id: 'd3', type: 'computer' }),
      },
    });
    renderSidebar({ collapsed: false });
    const link = screen.getByRole('link', { name: /Dispositivos/ });
    expect(within(link).getByText('2')).toBeInTheDocument();
  });

  it('sin desconocidos ni bloqueados, "Dispositivos" no lleva badge', () => {
    useInventoryStore.setState({
      devices: { d3: device({ id: 'd3', type: 'computer' }) },
    });
    renderSidebar({ collapsed: false });
    const link = screen.getByRole('link', { name: /Dispositivos/ });
    expect(within(link).queryByText('1')).not.toBeInTheDocument();
  });

  it('refleja el estado offline del driver con un dot de peligro', () => {
    renderSidebar({ collapsed: false, stats: { ...STATS, online: false } });
    expect(screen.getByLabelText('Error')).toBeInTheDocument();
  });

  it('renderiza el botón ThemeToggle en la sidebar', () => {
    renderSidebar({ collapsed: false });
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });

  it('al hacer clic en el ThemeToggle llama a toggleTheme', async () => {
    themeMock.toggleTheme.mockClear();
    const user = userEvent.setup();
    renderSidebar({ collapsed: false });
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));
    expect(themeMock.toggleTheme).toHaveBeenCalled();
  });
});
