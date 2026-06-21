import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, api, request } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const TOKENS = { accessToken: 'acc', refreshToken: 'ref', expiresIn: 900 };

describe('cliente API', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, tokens: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adjunta el access token cuando hay sesión', async () => {
    useAuthStore.setState({ tokens: TOKENS });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/system/stats');

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer acc');
  });

  it('omite el token en peticiones anónimas', async () => {
    useAuthStore.setState({ tokens: TOKENS });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    await request('/setup/status', { method: 'GET', anonymous: true });

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('devuelve undefined en 204 sin parsear body', async () => {
    useAuthStore.setState({ tokens: TOKENS });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(204, null)));
    expect(await api.del('/inventory/devices/x/block')).toBeUndefined();
  });

  it('lanza ApiRequestError con status y body en error', async () => {
    useAuthStore.setState({ tokens: TOKENS });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(404, { code: 'DEVICE_NOT_FOUND', message: 'no' })),
    );

    await expect(api.get('/inventory/devices/x')).rejects.toBeInstanceOf(ApiRequestError);
    try {
      await api.get('/inventory/devices/x');
    } catch (err) {
      expect(err).toMatchObject({ status: 404, body: { code: 'DEVICE_NOT_FOUND' } });
    }
  });

  it('ante 401 refresca el token y reintenta la petición original', async () => {
    useAuthStore.setState({ tokens: TOKENS });
    const fetchMock = vi
      .fn()
      // 1) petición original → 401
      .mockResolvedValueOnce(jsonResponse(401, { code: 'AUTH', message: 'expirado' }))
      // 2) /auth/refresh → nuevos tokens
      .mockResolvedValueOnce(jsonResponse(200, { accessToken: 'acc2', refreshToken: 'ref2', expiresIn: 900 }))
      // 3) reintento → 200
      .mockResolvedValueOnce(jsonResponse(200, { value: 42 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await api.get<{ value: number }>('/system/stats');

    expect(result).toEqual({ value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/auth/refresh');
    // El reintento usa el nuevo access token.
    const retryInit = fetchMock.mock.calls[2][1];
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer acc2');
    expect(useAuthStore.getState().tokens?.accessToken).toBe('acc2');
  });

  it('dos peticiones con 401 en paralelo disparan un solo /auth/refresh (US-56)', async () => {
    useAuthStore.setState({ tokens: TOKENS });
    // 401 mientras el token sea el viejo ('acc'); 200 una vez refrescado ('acc2').
    // El endpoint de refresh siempre devuelve el token nuevo.
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      if (url === '/api/auth/refresh') {
        return jsonResponse(200, { accessToken: 'acc2', refreshToken: 'ref2', expiresIn: 900 });
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      return auth === 'Bearer acc2'
        ? jsonResponse(200, { ok: true })
        : jsonResponse(401, { code: 'AUTH', message: 'expirado' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([
      api.get<{ ok: boolean }>('/system/stats'),
      api.get<{ ok: boolean }>('/system/info'),
    ]);

    expect(a).toEqual({ ok: true });
    expect(b).toEqual({ ok: true });
    // Ambos 401 comparten un único refresco (single-flight), no uno por petición.
    const refreshCalls = fetchMock.mock.calls.filter(([u]) => u === '/api/auth/refresh');
    expect(refreshCalls).toHaveLength(1);
    expect(useAuthStore.getState().tokens?.accessToken).toBe('acc2');
  });

  it('si el refresh falla, propaga el 401 original', async () => {
    useAuthStore.setState({ tokens: TOKENS });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { code: 'AUTH', message: 'expirado' }))
      .mockResolvedValueOnce(jsonResponse(401, { code: 'AUTH', message: 'refresh malo' }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/system/stats')).rejects.toBeInstanceOf(ApiRequestError);
    expect(useAuthStore.getState().tokens).toBeNull(); // refresh fallido limpió sesión
  });
});
