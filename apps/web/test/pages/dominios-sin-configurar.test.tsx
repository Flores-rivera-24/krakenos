import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Si el cuerpo de una página se montara con el dominio sin configurar, pediría datos que no
// existen: este mock cuenta cualquier petición.
const apiMock = vi.hoisted(() => {
  const noop = vi.fn(() => Promise.resolve([]));
  return { get: noop, getList: noop, post: noop, put: noop, patch: noop, del: noop };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import type { IntegrationDomain } from '@krakenos/types';
import { AutomationsPage } from '@/pages/AutomationsPage';
import { CamerasPage } from '@/pages/CamerasPage';
import { DnsPage } from '@/pages/DnsPage';
import { EnergyPage } from '@/pages/EnergyPage';
import { InventoryPage } from '@/pages/InventoryPage';
import { IotPage } from '@/pages/IotPage';
import { PeoplePage } from '@/pages/PeoplePage';
import { RoomsPage } from '@/pages/RoomsPage';
import { ScenesPage } from '@/pages/ScenesPage';
import { TrafficPage } from '@/pages/TrafficPage';
import { VlanPage } from '@/pages/VlanPage';
import { WifiPage } from '@/pages/WifiPage';
import { useEstadosStore } from '@/lib/integration-states';

/**
 * Las páginas de un dominio SIN CONFIGURAR no enseñan su estado vacío («no tienes
 * dispositivos», que culparía al usuario de algo que no depende de él): enseñan «Sin
 * configurar» con el camino a «Conectar», y su cuerpo ni se monta (cero peticiones).
 */
const BLOQUEAN: [string, () => React.ReactElement, IntegrationDomain, string][] = [
  ['Inventario', () => <InventoryPage />, 'driver', 'Dispositivos'],
  ['WiFi', () => <WifiPage />, 'driver', 'WiFi'],
  ['Tráfico', () => <TrafficPage />, 'driver', 'Tráfico'],
  ['Personas', () => <PeoplePage />, 'driver', 'Personas'],
  ['IoT', () => <IotPage />, 'iot', 'Dispositivos IoT'],
  ['Energía', () => <EnergyPage />, 'iot', 'Energía'],
  ['Cámaras', () => <CamerasPage />, 'cameras', 'Cámaras'],
  ['DNS', () => <DnsPage />, 'dns', 'DNS'],
  ['VLANs', () => <VlanPage />, 'vlan', 'VLANs'],
];

const NO_BLOQUEAN: [string, () => React.ReactElement][] = [
  ['Habitaciones', () => <RoomsPage />],
  ['Escenas', () => <ScenesPage />],
  ['Automatizaciones', () => <AutomationsPage />],
];

const renderPage = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('páginas con el dominio sin configurar', () => {
  beforeEach(() => {
    apiMock.get.mockClear();
  });
  afterEach(() => useEstadosStore.setState({ estados: null }));

  it('cubre las 9 páginas que sustituyen su cuerpo (guard de tamaño)', () => {
    expect(BLOQUEAN).toHaveLength(9);
  });

  it.each(BLOQUEAN)(
    '%s: «Sin configurar» + enlace a Conectar, un solo h1 y 0 peticiones',
    (_n, page, domain) => {
      useEstadosStore.setState({ estados: { [domain]: 'not-configured' } });
      renderPage(page());
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByText('Sin configurar')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Ir a Conectar' })).toHaveAttribute(
        'href',
        '/connect',
      );
      expect(apiMock.get).not.toHaveBeenCalled();
    },
  );

  it.each(BLOQUEAN)('%s: el estado de OTRO dominio no la bloquea', (_n, page, domain) => {
    const otro: IntegrationDomain = domain === 'dns' ? 'vlan' : 'dns';
    useEstadosStore.setState({ estados: { [otro]: 'not-configured' } });
    renderPage(page());
    expect(screen.queryByText('Sin configurar')).not.toBeInTheDocument();
  });

  it.each(NO_BLOQUEAN)(
    '%s se puede usar antes de conectar: no se sustituye ni avisa',
    (_n, page) => {
      useEstadosStore.setState({ estados: { iot: 'not-configured' } });
      renderPage(page());
      expect(screen.queryByText('Sin configurar')).not.toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Ir a Conectar' })).not.toBeInTheDocument();
    },
  );
});
