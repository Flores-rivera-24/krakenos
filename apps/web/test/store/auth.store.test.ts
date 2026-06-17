import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/store/auth.store';

/** Construye una respuesta tipo `fetch` mínima. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const USER = { id: 'u1', email: 'a@krakenos.test', displayName: 'A', role: 'admin' as const, createdAt: '', updatedAt: '' };
const TOKENS = { accessToken: 'acc', refreshToken: 'ref', expiresIn: 900 };

describe('useAuthStore', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, tokens: null });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('login guarda usuario y tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { user: USER, tokens: TOKENS }));
    vi.stubGlobal('fetch', fetchMock);

    await useAuthStore.getState().login('a@krakenos.test', 'password123');

    expect(fetchMock).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({ method: 'POST' }));
    expect(useAuthStore.getState().user).toEqual(USER);
    expect(useAuthStore.getState().tokens).toEqual(TOKENS);
  });

  it('login propaga el error y no fija sesión', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { code: 'X', message: 'no' })));
    await expect(useAuthStore.getState().login('a@krakenos.test', 'mala')).rejects.toThrow();
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('setSession hidrata la sesión (p. ej. tras el wizard)', () => {
    useAuthStore.getState().setSession({ user: USER, tokens: TOKENS });
    expect(useAuthStore.getState().user).toEqual(USER);
  });

  it('refresh sin token devuelve false', async () => {
    const refreshed = await useAuthStore.getState().refresh();
    expect(refreshed).toBe(false);
  });

  it('refresh exitoso actualiza los tokens', async () => {
    useAuthStore.setState({ user: USER, tokens: TOKENS });
    const nuevos = { accessToken: 'acc2', refreshToken: 'ref2', expiresIn: 900 };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, nuevos)));

    const ok = await useAuthStore.getState().refresh();
    expect(ok).toBe(true);
    expect(useAuthStore.getState().tokens).toEqual(nuevos);
  });

  it('refresh fallido limpia la sesión', async () => {
    useAuthStore.setState({ user: USER, tokens: TOKENS });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { code: 'X', message: 'no' })));

    const ok = await useAuthStore.getState().refresh();
    expect(ok).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().tokens).toBeNull();
  });

  it('logout revoca el refresh y limpia la sesión', async () => {
    useAuthStore.setState({ user: USER, tokens: TOKENS });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(204, null));
    vi.stubGlobal('fetch', fetchMock);

    await useAuthStore.getState().logout();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', expect.objectContaining({ method: 'POST' }));
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().tokens).toBeNull();
  });

  it('logout sin error aunque la petición falle', async () => {
    useAuthStore.setState({ user: USER, tokens: TOKENS });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('red caída')));
    await expect(useAuthStore.getState().logout()).resolves.toBeUndefined();
    expect(useAuthStore.getState().tokens).toBeNull();
  });
});
