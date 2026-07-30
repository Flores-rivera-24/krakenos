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

  it('refresh concurrente hace un solo POST (single-flight, US-56)', async () => {
    useAuthStore.setState({ user: USER, tokens: TOKENS });
    const nuevos = { accessToken: 'acc2', refreshToken: 'ref2', expiresIn: 900 };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, nuevos));
    vi.stubGlobal('fetch', fetchMock);

    const [a, b] = await Promise.all([
      useAuthStore.getState().refresh(),
      useAuthStore.getState().refresh(),
    ]);

    expect(a).toBe(true);
    expect(b).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1); // un solo /auth/refresh para ambos
    expect(useAuthStore.getState().tokens).toEqual(nuevos);

    // Tras resolverse, un nuevo refresh vuelve a disparar su propio POST.
    await useAuthStore.getState().refresh();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('refresh fallido limpia la sesión', async () => {
    useAuthStore.setState({ user: USER, tokens: TOKENS });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, { code: 'X', message: 'no' })));

    const ok = await useAuthStore.getState().refresh();
    expect(ok).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().tokens).toBeNull();
    expect(useAuthStore.getState().lastRefreshFailure).toBe('expired');
  });

  /**
   * US-234 (AUD3-25) — el `catch` de `refresh()` era **ciego**: trataba un
   * `HttpError(0)` (la red) igual que un 401 (la sesión). Recargar mientras el
   * agente se reinicia —que es literalmente lo que hace el actualizador de
   * US-190— o un parpadeo del túnel te devolvían al login **con la cookie
   * todavía buena**.
   */
  describe('un fallo de red NO es una sesión caducada (US-234)', () => {
    it('la sesión sobrevive a un fallo de red', async () => {
      useAuthStore.setState({ user: USER, tokens: TOKENS });
      // `fetch` rechaza: servidor inaccesible, no hay respuesta HTTP.
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      expect(await useAuthStore.getState().refresh()).toBe(false);
      expect(useAuthStore.getState().user).toEqual(USER); // ← lo que antes se perdía
      expect(useAuthStore.getState().lastRefreshFailure).toBe('unreachable');
    });

    it('la sesión sobrevive a un 5xx (el agente arrancando)', async () => {
      useAuthStore.setState({ user: USER, tokens: TOKENS });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503, { code: 'X', message: 'no' })));

      expect(await useAuthStore.getState().refresh()).toBe(false);
      expect(useAuthStore.getState().user).toEqual(USER);
      expect(useAuthStore.getState().lastRefreshFailure).toBe('unreachable');
    });

    it('un 403 SÍ cierra la sesión (cuenta deshabilitada o rol retirado)', async () => {
      useAuthStore.setState({ user: USER, tokens: TOKENS });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(403, { code: 'X', message: 'no' })));

      expect(await useAuthStore.getState().refresh()).toBe(false);
      expect(useAuthStore.getState().user).toBeNull();
      expect(useAuthStore.getState().lastRefreshFailure).toBe('expired');
    });

    it('un refresh correcto borra la marca de fallo anterior', async () => {
      useAuthStore.setState({ user: USER, lastRefreshFailure: 'unreachable' });
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, TOKENS)));

      expect(await useAuthStore.getState().refresh()).toBe(true);
      expect(useAuthStore.getState().lastRefreshFailure).toBeNull();
    });
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

  it('logout vacía los favoritos del usuario saliente (US-207)', async () => {
    const { useFavoritesStore } = await import('@/store/favorites.store');
    useAuthStore.setState({ user: USER, tokens: TOKENS });
    useFavoritesStore.setState({
      favorites: [{ id: 'f1', kind: 'iot', ref: 'light', order: 0, createdAt: '' }],
      loaded: true,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(204, null)));

    await useAuthStore.getState().logout();
    expect(useFavoritesStore.getState().favorites).toHaveLength(0);
    expect(useFavoritesStore.getState().loaded).toBe(false);
  });
});
