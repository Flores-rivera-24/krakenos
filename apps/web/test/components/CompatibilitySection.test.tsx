import type { CompatibilityEntry } from '@krakenos/types';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const compatMock = vi.hoisted(() => ({ listCompatibility: vi.fn() }));
vi.mock('@/lib/compatibility', () => compatMock);

import { CompatibilitySection } from '@/components/connect/CompatibilitySection';

const CATALOG: CompatibilityEntry[] = [
  { id: 'driver:openwrt', category: 'driver', label: 'Router OpenWrt', capabilities: ['inventory', 'wifi'], requirements: ['address', 'credentials'], verified: false },
  { id: 'iot:hue', category: 'iot', label: 'Philips Hue', capabilities: ['control'], requirements: ['address', 'credentials'], verified: false },
  { id: 'dns:pihole', category: 'dns', label: 'Pi-hole', capabilities: ['dns-block'], requirements: ['address'], verified: false },
];

describe('CompatibilitySection (US-208)', () => {
  beforeEach(() => {
    compatMock.listCompatibility.mockReset().mockResolvedValue(CATALOG);
  });

  it('lista el catálogo con capacidades y el estado sin verificar', async () => {
    render(<CompatibilitySection />);
    expect(await screen.findByText('Router OpenWrt')).toBeInTheDocument();
    expect(screen.getByText('Philips Hue')).toBeInTheDocument();
    expect(screen.getAllByText('Soportado por código').length).toBeGreaterThan(0);
  });

  it('busca por marca/modelo', async () => {
    render(<CompatibilitySection />);
    await screen.findByText('Router OpenWrt');
    fireEvent.change(screen.getByLabelText('Buscar por marca o modelo'), { target: { value: 'hue' } });
    expect(screen.getByText('Philips Hue')).toBeInTheDocument();
    expect(screen.queryByText('Router OpenWrt')).not.toBeInTheDocument();
  });

  it('filtra por categoría', async () => {
    render(<CompatibilitySection />);
    await screen.findByText('Router OpenWrt');
    fireEvent.click(screen.getByRole('button', { name: 'DNS' }));
    expect(screen.getByText('Pi-hole')).toBeInTheDocument();
    expect(screen.queryByText('Philips Hue')).not.toBeInTheDocument();
  });

  it('es honesto cuando no encuentra el equipo', async () => {
    render(<CompatibilitySection />);
    await screen.findByText('Router OpenWrt');
    fireEvent.change(screen.getByLabelText('Buscar por marca o modelo'), { target: { value: 'zzz' } });
    expect(screen.getByText(/no significa que no funcione/)).toBeInTheDocument();
  });
});
