import type { IntegrationField } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// El hub carga el catálogo vía el `api` genérico; lo stubbeamos.
const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  patch: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { ConnectPage } from '@/pages/ConnectPage';
import { useToastStore } from '@/store/toast.store';

function view(domain: string, kinds: { kind: string; label: string; fields?: IntegrationField[]; zeroConfig?: boolean }[]) {
  return {
    domain,
    kinds: kinds.map((k) => ({ domain, fields: [], ...k })),
    current: null,
    effectiveKind: kinds[0]?.kind ?? 'mock',
    source: 'env',
  };
}

const DOMAINS = [
  view('driver', [
    { kind: 'mock', label: 'Modo demostración', zeroConfig: true },
    {
      kind: 'openwrt',
      label: 'OpenWrt',
      fields: [
        { key: 'host', type: 'host', required: true },
        { key: 'password', type: 'password', required: true, secret: true },
      ],
    },
  ]),
  view('vpn', [{ kind: 'mock', label: 'Demo', zeroConfig: true }]),
  view('iot', [{ kind: 'mock', label: 'Demo', zeroConfig: true }]),
  view('cameras', [{ kind: 'mock', label: 'Demo', zeroConfig: true }]),
  view('firewall', [{ kind: 'mock', label: 'Demo', zeroConfig: true }]),
  view('vlan', [{ kind: 'mock', label: 'Demo', zeroConfig: true }]),
  view('qos', [{ kind: 'mock', label: 'Demo', zeroConfig: true }]),
  view('dns', [{ kind: 'mock', label: 'Demo', zeroConfig: true }]),
];

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/connect']}>
      <Routes>
        <Route path="/connect" element={<ConnectPage />} />
        <Route path="/vpn" element={<div>PÁGINA VPN</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ConnectPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue({ domains: DOMAINS });
    apiMock.put.mockReset().mockResolvedValue({});
    apiMock.post.mockReset().mockResolvedValue({});
    useToastStore.setState({ toasts: [] });
  });

  it('agrupa las guías en secciones amables por categoría', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Tu red y router' })).toBeInTheDocument(),
    );
    for (const label of [
      'Luces inteligentes',
      'Enchufes e interruptores',
      'Cámaras',
      'Acceso remoto (VPN)',
      'Bloqueo de anuncios (DNS)',
      'Red avanzada',
    ]) {
      expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    }
  });

  it('al pulsar una tarjeta config-style abre el asistente en un slideover', async () => {
    const user = userEvent.setup();
    renderPage();
    const card = await screen.findByRole('button', { name: /OpenWrt/ });
    await user.click(card);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Conectar OpenWrt')).toBeInTheDocument();
    expect(screen.getAllByText(/Paso 1 de 3/).length).toBeGreaterThan(0);
  });

  it('una tarjeta especial (VPN) navega en vez de abrir el asistente', async () => {
    const user = userEvent.setup();
    renderPage();
    const card = await screen.findByRole('button', { name: /Acceso remoto/ });
    await user.click(card);

    expect(await screen.findByText('PÁGINA VPN')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
