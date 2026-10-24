import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return {
    get,
    getList: vi.fn((path: string) => get(path)),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  };
});
vi.mock('@/lib/api', () => ({
  api: apiMock,
  ApiRequestError: class ApiRequestError extends Error {},
}));

import { DnsFeeds } from '@/components/dns/DnsFeeds';
import { ensureCatalog, setLocale } from '@/lib/i18n';
import { useToastStore } from '@/store/toast.store';

// Lo que manda el agente: id, url y estado. El nombre y la descripción viven en el
// catálogo de la web (el agente no manda copy, que no se podría traducir).
const FEEDS = [{ id: 'ads', url: 'http://x', enabled: false }];

describe('DnsFeeds — feeds de categoría (US-114)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue(FEEDS);
    apiMock.patch.mockReset().mockResolvedValue({ ...FEEDS[0], enabled: true });
    useToastStore.setState({ toasts: [] });
  });

  it('lista y activa un feed (admin)', async () => {
    const user = userEvent.setup();
    render(<DnsFeeds canEdit />);
    await screen.findByText('Publicidad y rastreo');

    await user.click(screen.getByRole('switch', { name: 'Activar Publicidad y rastreo' }));
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/dns/feeds/ads', { enabled: true }),
    );
  });

  it('si falla la carga lo dice con «Reintentar» (no un «Cargando…» eterno) y se recupera', async () => {
    apiMock.get.mockReset().mockRejectedValue(new Error('caído'));
    render(<DnsFeeds canEdit />);
    expect(await screen.findByText('No se pudieron cargar las listas')).toBeInTheDocument();
    expect(screen.queryByText('Cargando…')).not.toBeInTheDocument();
    apiMock.get.mockReset().mockResolvedValue(FEEDS);
    await userEvent.click(screen.getByRole('button', { name: /Reintentar/ }));
    expect(await screen.findByText('Publicidad y rastreo')).toBeInTheDocument();
  });

  it('un viewer no puede togglear (switch deshabilitado)', async () => {
    render(<DnsFeeds canEdit={false} />);
    await screen.findByText('Publicidad y rastreo');
    expect(screen.getByRole('switch', { name: 'Activar Publicidad y rastreo' })).toBeDisabled();
  });
});

describe('DnsFeeds — el copy sale del catálogo, no del servidor', () => {
  beforeAll(() => ensureCatalog('en'));
  afterEach(() => setLocale('es', { persist: false }));
  beforeEach(() => {
    apiMock.get.mockReset();
  });

  it('nombre y descripción se traducen con la interfaz en inglés', async () => {
    apiMock.get.mockResolvedValue([
      { id: 'ads', url: 'http://x', enabled: false },
      { id: 'malware', url: 'http://y', enabled: true },
    ]);
    setLocale('en', { persist: false });
    render(<DnsFeeds canEdit />);
    expect(await screen.findByText('Ads and tracking')).toBeInTheDocument();
    expect(
      screen.getByText('Blocks common ads, banners and trackers (StevenBlack).'),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Enable Malware and phishing' })).toBeInTheDocument();
    expect(screen.queryByText('Publicidad y rastreo')).toBeNull();
  });

  it('en español conserva el texto de siempre, palabra por palabra', async () => {
    apiMock.get.mockResolvedValue([{ id: 'tracking-extended', url: 'http://z', enabled: false }]);
    render(<DnsFeeds canEdit />);
    expect(await screen.findByText('Rastreo extendido')).toBeInTheDocument();
    expect(
      screen.getByText('Telemetría y rastreo adicional (lista de Perflyst/SmartTV opcional).'),
    ).toBeInTheDocument();
  });

  it('un id que esta versión no conoce se declara, no se pinta crudo', async () => {
    apiMock.get.mockResolvedValue([{ id: 'lista-nueva', url: 'http://n', enabled: false }]);
    render(<DnsFeeds canEdit />);
    expect(await screen.findByText('Lista no reconocida (lista-nueva)')).toBeInTheDocument();
  });
});
