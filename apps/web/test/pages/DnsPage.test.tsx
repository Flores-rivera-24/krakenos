import type { BlockedDomain, DnsHistoryResponse, DnsQuery, DnsStats } from '@krakenos/types';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return {
    get,
    getList: vi.fn((path: string) => get(path)),
    post: vi.fn(),
    del: vi.fn(),
  };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { DnsPage } from '@/pages/DnsPage';
import { useAuthStore } from '@/store/auth.store';

const STATS: DnsStats = {
  totalQueries: 1280,
  blockedQueries: 312,
  blockedPercent: 24,
  blocklistSize: 3,
};

const BLOCKED: BlockedDomain = {
  id: 'b1',
  domain: 'ads.doubleclick.net',
  createdAt: '2026-06-17T00:00:00.000Z',
};

const QUERY: DnsQuery = {
  timestamp: '2026-06-17T10:00:00.000Z',
  domain: 'github.com',
  client: '10.0.0.10',
  blocked: false,
};

/** Histórico persistido (US-252) con un aparato identificado y otro sin atribuir. */
const HISTORY: DnsHistoryResponse = {
  entries: [
    {
      id: 'h1',
      timestamp: '2026-06-17T10:00:00.000Z',
      domain: 'telemetria.example',
      blocked: true,
      mac: 'aa:00',
      deviceLabel: 'Tablet de Marta',
    },
    {
      id: 'h2',
      timestamp: '2026-06-17T09:59:00.000Z',
      // Distinto del dominio del registro EN VIVO (`github.com`) a propósito: hay
      // tests que comprueban que un viewer no ve ese registro, y un dominio
      // compartido entre las dos tarjetas los volvería ambiguos.
      domain: 'cdn.example',
      blocked: false,
      mac: null,
      deviceLabel: null,
    },
  ],
  coverage: { recording: true, silentDevices: 0, onlineDevices: 4, retentionDays: 7 },
};

function mockApi(history: DnsHistoryResponse = HISTORY) {
  apiMock.get.mockImplementation((path: string) => {
    if (path === '/dns/stats') return Promise.resolve(STATS);
    if (path === '/dns/blocklist') return Promise.resolve([BLOCKED]);
    if (path.startsWith('/dns/history')) return Promise.resolve(history);
    return Promise.resolve([QUERY]); // /dns/queries
  });
}

function setRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'Emilio', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

describe('DnsPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset().mockResolvedValue(BLOCKED);
    apiMock.del.mockReset().mockResolvedValue(undefined);
    mockApi();
    setRole('admin');
  });

  it('muestra estadísticas, blocklist y consultas recientes', async () => {
    render(<DnsPage />);
    await waitFor(() => expect(screen.getByText('24%')).toBeInTheDocument());
    expect(screen.getByText('ads.doubleclick.net')).toBeInTheDocument();
    expect(screen.getByText('github.com')).toBeInTheDocument();
    // Acotado a SU fila: desde que el histórico (US-252) es una segunda tabla con
    // el mismo vocabulario de estado, un `getByText('Permitida')` suelto es ambiguo.
    const fila = screen.getByText('github.com').closest('tr')!;
    expect(within(fila).getByText('Permitida')).toBeInTheDocument();
    expect(apiMock.get).toHaveBeenCalledWith('/dns/queries?limit=20');
  });

  it('bloquea un dominio con el formulario (admin)', async () => {
    render(<DnsPage />);
    await screen.findByText('ads.doubleclick.net');

    await userEvent.type(screen.getByLabelText('Dominio'), 'tracker.nuevo.com');
    await userEvent.click(screen.getByRole('button', { name: /Bloquear/ }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/dns/blocklist', { domain: 'tracker.nuevo.com' }),
    );
  });

  it('un viewer no ve el formulario ni el botón de quitar', async () => {
    setRole('viewer');
    render(<DnsPage />);
    await screen.findByText('ads.doubleclick.net');
    expect(screen.queryByText('Bloquear dominio')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Quitar' })).not.toBeInTheDocument();
  });

  describe('registro de consultas acotado por rol (US-250)', () => {
    it('un viewer ve la explicación, y las cifras y la lista siguen ahí', async () => {
      setRole('viewer');
      render(<DnsPage />);

      expect(await screen.findByText(/Solo el administrador ve las consultas/i)).toBeInTheDocument();
      expect(screen.queryByText('github.com')).not.toBeInTheDocument();
      // La regresión que hay que evitar: las tres peticiones vivían en un mismo
      // `Promise.all`, así que el 403 del registro habría dejado la página entera
      // en blanco por una restricción que solo afecta a una tarjeta.
      expect(screen.getByText('24%')).toBeInTheDocument();
      expect(screen.getByText('ads.doubleclick.net')).toBeInTheDocument();
      // Y ni se pide el registro.
      expect(apiMock.get).not.toHaveBeenCalledWith('/dns/queries?limit=20');
    });

    it('no dice «no hay consultas» cuando lo que falta es el permiso', async () => {
      setRole('viewer');
      render(<DnsPage />);
      await screen.findByText(/Solo el administrador ve las consultas/i);
      // «Aún no hay consultas recientes» sería mentira: puede haberlas.
      expect(screen.queryByText(/Aún no hay consultas recientes/)).not.toBeInTheDocument();
    });
  });

  it('muestra un banner role="alert" si la carga falla (US-93)', async () => {
    apiMock.get.mockReset().mockRejectedValue(new Error('boom'));
    render(<DnsPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No se pudo conectar con el servidor/);
  });

  it('muestra estados vacíos honestos sin datos (US-93)', async () => {
    apiMock.get.mockReset().mockImplementation((path: string) => {
      if (path === '/dns/stats') return Promise.resolve(STATS);
      if (path.startsWith('/dns/history')) {
        return Promise.resolve({
          entries: [],
          coverage: { recording: false, silentDevices: 0, onlineDevices: 0, retentionDays: 7 },
        } satisfies DnsHistoryResponse);
      }
      return Promise.resolve([]); // blocklist + queries vacíos
    });
    render(<DnsPage />);
    expect(await screen.findByText(/Aún no hay dominios bloqueados/)).toBeInTheDocument();
    expect(screen.getByText(/Aún no hay consultas recientes/)).toBeInTheDocument();
  });
});

/**
 * US-252. El histórico persistido. A diferencia del registro en vivo, esta
 * tarjeta la ve cualquier rol —el servidor filtra a los aparatos de quien mira—,
 * y lo que se prueba aquí es sobre todo que **dice lo que no ve**.
 */
describe('DnsPage · histórico por dispositivo (US-252)', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset().mockResolvedValue(BLOCKED);
    apiMock.del.mockReset().mockResolvedValue(undefined);
    mockApi();
    setRole('admin');
  });

  it('lista las consultas con el aparato al que pertenecen', async () => {
    render(<DnsPage />);
    expect(await screen.findByText('telemetria.example')).toBeInTheDocument();
    expect(screen.getByText('Tablet de Marta')).toBeInTheDocument();
  });

  it('una consulta que no se pudo atribuir se marca, no se esconde', async () => {
    render(<DnsPage />);
    await screen.findByText('telemetria.example');
    expect(screen.getByText('Sin identificar')).toBeInTheDocument();
  });

  it('⚠️ avisa de los aparatos que no pasan por el resolver (la respuesta honesta a DoH)', async () => {
    mockApi({
      ...HISTORY,
      coverage: { recording: true, silentDevices: 3, onlineDevices: 5, retentionDays: 7 },
    });
    render(<DnsPage />);
    // Sin este aviso, una tabla corta se lee como «no salió nada de casa», que es
    // mentira justo con los aparatos que preocupan.
    expect(await screen.findByText(/3 de tus 5 dispositivos en línea/)).toBeInTheDocument();
    expect(screen.getByText(/DoH o un DNS fijo/)).toBeInTheDocument();
  });

  it('sin aparatos callados no mete un aviso que no aplica', async () => {
    render(<DnsPage />);
    await screen.findByText('telemetria.example');
    expect(screen.queryByText(/dispositivos en línea/)).not.toBeInTheDocument();
  });

  it('declara la retención con los datos, no en un aparte', async () => {
    render(<DnsPage />);
    expect(await screen.findByText(/Se conservan 7 días/)).toBeInTheDocument();
  });

  it('distingue «aún no se ha registrado nada» de «tus aparatos no han consultado»', async () => {
    mockApi({
      entries: [],
      coverage: { recording: false, silentDevices: 0, onlineDevices: 2, retentionDays: 7 },
    });
    render(<DnsPage />);
    // Llevan a sitios distintos: uno es que el histórico no está recibiendo nada,
    // el otro es silencio real de unos aparatos concretos.
    expect(await screen.findByText(/Aún no se ha registrado ninguna consulta/)).toBeInTheDocument();

    mockApi({
      entries: [],
      coverage: { recording: true, silentDevices: 0, onlineDevices: 2, retentionDays: 7 },
    });
    render(<DnsPage />);
    expect(await screen.findByText(/no han hecho consultas en este periodo/)).toBeInTheDocument();
  });

  it('un no-admin ve el histórico (filtrado en el servidor), con su propio subtítulo', async () => {
    setRole('viewer');
    render(<DnsPage />);
    // El registro EN VIVO le está negado (US-250), pero el histórico no: el
    // servidor ya le ha quitado lo que no es suyo.
    expect(await screen.findByText(/A qué dominios han hablado tus dispositivos/)).toBeInTheDocument();
    expect(screen.getByText('telemetria.example')).toBeInTheDocument();
  });

  it('solo un admin puede borrar el histórico', async () => {
    setRole('viewer');
    render(<DnsPage />);
    await screen.findByText('telemetria.example');
    expect(screen.queryByRole('button', { name: /Eliminar el histórico/ })).not.toBeInTheDocument();
  });

  it('un admin lo borra con confirmación de dos pasos', async () => {
    render(<DnsPage />);
    await screen.findByText('telemetria.example');

    await userEvent.click(screen.getByRole('button', { name: /Eliminar el histórico/ }));
    // Un registro de navegación no se borra de un toque distraído.
    expect(apiMock.del).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    await waitFor(() => expect(apiMock.del).toHaveBeenCalledWith('/dns/history'));
  });
});
