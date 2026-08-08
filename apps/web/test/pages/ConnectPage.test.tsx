import type { IntegrationField } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// El hub carga el catálogo vía el `api` genérico; lo stubbeamos.
const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return {
    get,
    getList: vi.fn((path: string) => get(path)),
    post: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
    patch: vi.fn(),
  };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { ConnectPage } from '@/pages/ConnectPage';
import { useAuthStore } from '@/store/auth.store';
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

/** Tarjetas de sugerencia del auto-descubrimiento (US-175). */
describe('ConnectPage — detectados en tu red', () => {
  const HUE_SUGGESTION = {
    id: 'hue:192.168.1.2',
    domain: 'iot',
    kind: 'hue',
    label: 'Bridge Philips Hue',
    ip: '192.168.1.2',
    hostname: 'Hue Bridge',
    prefill: { bridgeUrl: 'http://192.168.1.2' },
    source: 'mdns',
    lastSeen: new Date().toISOString(),
  };

  const DOMAINS_WITH_HUE = DOMAINS.map((v) =>
    v.domain === 'iot'
      ? view('iot', [
          { kind: 'mock', label: 'Demo', zeroConfig: true },
          {
            kind: 'hue',
            label: 'Philips Hue',
            fields: [
              { key: 'bridgeUrl', type: 'url', required: true },
              { key: 'appKey', type: 'password', required: true, secret: true },
            ],
          },
        ])
      : v,
  );

  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) => {
      if (path === '/integrations') return Promise.resolve({ domains: DOMAINS_WITH_HUE });
      if (path === '/discovery')
        return Promise.resolve({ suggestions: [HUE_SUGGESTION], scanning: false, lastScanAt: null });
      return Promise.resolve({});
    });
    apiMock.del.mockReset().mockResolvedValue(undefined);
    useAuthStore.setState({
      user: { id: 'u', email: 'a@b.c', displayName: 'A', role: 'admin', createdAt: '', updatedAt: '' },
      tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
    });
    useToastStore.setState({ toasts: [] });
  });

  it('muestra la sugerencia y abre el asistente precargado con la IP detectada', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('Bridge Philips Hue')).toBeInTheDocument();
    expect(screen.getByText(/192\.168\.1\.2/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Conectar' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();

    // Avanza al paso "Conecta": el campo llega precargado con lo detectado.
    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(screen.getByLabelText(/Dirección del bridge/)).toHaveValue('http://192.168.1.2');
  });

  it('descartar una sugerencia llama al API y quita la tarjeta', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Bridge Philips Hue');
    await user.click(screen.getByRole('button', { name: /Descartar Bridge Philips Hue/ }));

    await waitFor(() =>
      expect(apiMock.del).toHaveBeenCalledWith('/discovery/suggestions/hue%3A192.168.1.2'),
    );
    expect(screen.queryByText('Bridge Philips Hue')).not.toBeInTheDocument();
  });
});
