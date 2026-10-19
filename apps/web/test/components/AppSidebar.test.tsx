import type { Device } from '@krakenos/types';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `ThemeToggle` (US-44) usa lib/theme; lo mockeamos para aislar el sidebar.
const themeMock = vi.hoisted(() => ({
  getTheme: vi.fn(() => 'dark'),
  toggleTheme: vi.fn(() => 'light'),
  applyTheme: vi.fn(),
}));
vi.mock('@/lib/theme', () => themeMock);

// US-239: la sidebar ya no recibe `stats` por prop — los pide ella con
// `useSidebarStats`, para no sondear 4 endpoints en móvil donde no se pinta.
const statsMock = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('@/lib/sidebar-stats', () => ({
  useSidebarStats: () => statsMock.current,
}));

import { AppSidebar } from '@/components/layout/AppSidebar';
import type { SidebarStats } from '@/lib/sidebar-stats';
import { useAuthStore } from '@/store/auth.store';
import { useInventoryStore } from '@/store/inventory.store';

const STATS: SidebarStats = {
  driverState: 'configured',
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
    icon: null,
    roomId: null,
    ownerId: null,
    ...over,
  };
}

function renderSidebar(props: { collapsed: boolean; stats?: SidebarStats }) {
  statsMock.current = props.stats ?? STATS;
  return render(
    <MemoryRouter>
      <AppSidebar collapsed={props.collapsed} onToggle={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('AppSidebar', () => {
  beforeEach(() => {
    useAuthStore.setState({
      user: {
        id: 'u',
        email: 'a@b.c',
        displayName: 'Emilio Flores',
        role: 'admin',
        createdAt: '',
        updatedAt: '',
      },
      logout: vi.fn(),
    });
    useInventoryStore.setState({ devices: {} });
  });

  it('expandida muestra marca, labels y estado del driver', () => {
    renderSidebar({ collapsed: false });
    expect(screen.getByText('KrakenOS')).toBeInTheDocument();
    expect(screen.getByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('Ajustes')).toBeInTheDocument();
    // Estado del driver en la zona inferior. Antes enseñaba `stats.driver`, un campo que
    // `/health` no manda (es público y mínimo): en producción era siempre «—», y este
    // fixture lo disimulaba con `driver: 'openwrt'`.
    expect(screen.getByText('Conectado')).toBeInTheDocument();
  });

  it.each([
    ['configured', 'Conectado'],
    ['demo', 'Demostración'],
    ['not-configured', 'Sin configurar'],
  ] as const)('el router en estado %s se etiqueta «%s»', (driverState, etiqueta) => {
    renderSidebar({ collapsed: false, stats: { ...STATS, driverState } });
    expect(screen.getByText(etiqueta)).toBeInTheDocument();
  });

  it('mientras no se sabe el estado del router no inventa ninguno', () => {
    renderSidebar({ collapsed: false, stats: { ...STATS, driverState: null } });
    expect(screen.queryByText('Conectado')).not.toBeInTheDocument();
    expect(screen.queryByText('Demostración')).not.toBeInTheDocument();
    expect(screen.queryByText('Sin configurar')).not.toBeInTheDocument();
  });

  it('modo sencillo (US-176): sin «Red avanzada» y sin jerga de driver', () => {
    useAuthStore.setState({
      user: {
        id: 'u',
        email: 'a@b.c',
        displayName: 'Emilio Flores',
        role: 'admin',
        uiMode: 'simple',
        createdAt: '',
        updatedAt: '',
      },
      logout: vi.fn(),
    });
    renderSidebar({ collapsed: false });
    expect(screen.queryByText('Red avanzada')).not.toBeInTheDocument();
    expect(screen.queryByText('Firewall')).not.toBeInTheDocument();
    // El estado técnico del driver se sustituye por un texto llano.
    expect(screen.queryByText('Conectado')).not.toBeInTheDocument();
    expect(screen.getByText('Casa conectada')).toBeInTheDocument();
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

  it('queda fija a la altura de la ventana: la nav hace scroll por dentro y el pie siempre se ve', () => {
    // jsdom no calcula layout: se ata la receta (el comportamiento real lo mide
    // `e2e/tests/navegacion.spec.ts`). `self-start` es la pieza que se olvida: sin ella el
    // flex estira el aside a la altura del documento y el `sticky` no tiene recorrido.
    const { container } = renderSidebar({ collapsed: false });
    const aside = container.querySelector('aside');
    for (const clase of ['sticky', 'top-0', 'h-dvh', 'self-start']) {
      expect(aside, clase).toHaveClass(clase);
    }
    // La lista se desplaza por dentro y «Ajustes» queda FUERA de lo que se desplaza.
    const scroll = container.querySelector('aside > nav > div.overflow-y-auto');
    expect(scroll).toBeInTheDocument();
    expect(scroll).not.toContainElement(screen.getByRole('link', { name: 'Ajustes' }));
    expect(scroll).toContainElement(screen.getByRole('link', { name: 'Dashboard' }));
  });

  it('en ventana baja (variante `bajo`) la barra entera es el contenedor con scroll', () => {
    // La receta; el efecto lo mide `e2e/tests/navegacion.spec.ts` (jsdom no evalúa media queries).
    const { container } = renderSidebar({ collapsed: false });
    expect(container.querySelector('aside')).toHaveClass('bajo:overflow-y-auto');
    const lista = container.querySelector('aside > nav > div.overflow-y-auto');
    expect(lista).toHaveClass('bajo:overflow-visible', 'bajo:flex-none');
    expect(container.querySelector('aside > nav')).toHaveClass('bajo:flex-none');
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

  it('cada contador dice qué cuenta, con su plural, en el nombre accesible y en el title', () => {
    useInventoryStore.setState({
      devices: {
        d1: device({ id: 'd1', type: 'unknown' }),
        d2: device({ id: 'd2', isBlocked: true }),
        d3: device({ id: 'd3', type: 'unknown', mac: 'aa:bb:cc:dd:ee:01' }),
      },
    });
    // Asimétricos: 3 desconocidos o bloqueados, 1 regla activa, 2 aparatos IoT caídos.
    renderSidebar({ collapsed: false, stats: { ...STATS, firewallActive: 1, iotOffline: 2 } });
    const dispositivos = screen.getByRole('link', { name: /Dispositivos/ });
    expect(dispositivos).toHaveAccessibleName(
      /^Dispositivos\s?3 dispositivos desconocidos o bloqueados$/,
    );
    expect(
      within(dispositivos).getByTitle('3 dispositivos desconocidos o bloqueados'),
    ).toBeTruthy();
    // El singular no se queda en «1 reglas».
    expect(screen.getByRole('link', { name: /Firewall/ })).toHaveAccessibleName(
      /^Firewall\s?1 regla activa$/,
    );
    expect(screen.getByRole('link', { name: /IoT/ })).toHaveAccessibleName(
      /^IoT\s?2 dispositivos IoT desconectados$/,
    );
  });

  it('el contador de reglas activas es un inventario, no un aviso: no lleva el acento', () => {
    renderSidebar({ collapsed: false, stats: { ...STATS, firewallActive: 4, iotOffline: 2 } });
    const regla = screen.getByTitle('4 reglas activas');
    expect(regla).not.toHaveClass('bg-kr-accent');
    expect(screen.getByTitle('2 dispositivos IoT desconectados')).toHaveClass('bg-kr-accent');
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
    expect(screen.getByRole('button', { name: 'Cambiar a modo claro' })).toBeInTheDocument();
  });

  it('al hacer clic en el ThemeToggle llama a toggleTheme', async () => {
    themeMock.toggleTheme.mockClear();
    const user = userEvent.setup();
    renderSidebar({ collapsed: false });
    await user.click(screen.getByRole('button', { name: 'Cambiar a modo claro' }));
    expect(themeMock.toggleTheme).toHaveBeenCalled();
  });
});
