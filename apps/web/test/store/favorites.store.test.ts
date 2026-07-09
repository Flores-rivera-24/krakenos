import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { useFavoritesStore } from '@/store/favorites.store';

describe('favorites.store (US-170)', () => {
  beforeEach(() => {
    useFavoritesStore.setState({ favorites: [], loaded: false });
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    apiMock.del.mockReset();
  });

  it('carga los favoritos del usuario una sola vez (idempotente)', async () => {
    apiMock.get.mockResolvedValue([{ id: 'f1', kind: 'iot', ref: 'light', order: 0, createdAt: '' }]);
    await useFavoritesStore.getState().load();
    await useFavoritesStore.getState().load(); // segunda llamada: no refetch
    expect(apiMock.get).toHaveBeenCalledTimes(1);
    expect(useFavoritesStore.getState().favorites).toHaveLength(1);
  });

  it('deduplica cargas concurrentes en una sola petición', async () => {
    apiMock.get.mockResolvedValue([]);
    await Promise.all([useFavoritesStore.getState().load(), useFavoritesStore.getState().load()]);
    expect(apiMock.get).toHaveBeenCalledTimes(1);
  });

  it('toggle fija (POST) cuando no existe y devuelve true', async () => {
    apiMock.post.mockResolvedValue({ id: 'f1', kind: 'iot', ref: 'light', order: 0, createdAt: '' });
    const now = await useFavoritesStore.getState().toggle('iot', 'light');
    expect(now).toBe(true);
    expect(apiMock.post).toHaveBeenCalledWith('/favorites', { kind: 'iot', ref: 'light' });
    expect(useFavoritesStore.getState().isFavorite('iot', 'light')).toBe(true);
  });

  it('toggle quita (DELETE) cuando ya existe y devuelve false', async () => {
    useFavoritesStore.setState({
      favorites: [{ id: 'f1', kind: 'iot', ref: 'light', order: 0, createdAt: '' }],
      loaded: true,
    });
    apiMock.del.mockResolvedValue(undefined);
    const now = await useFavoritesStore.getState().toggle('iot', 'light');
    expect(now).toBe(false);
    expect(apiMock.del).toHaveBeenCalledWith('/favorites/f1');
    expect(useFavoritesStore.getState().favorites).toHaveLength(0);
  });

  it('reset vacía el espejo y permite recargar (logout, US-207)', async () => {
    useFavoritesStore.setState({
      favorites: [{ id: 'f1', kind: 'iot', ref: 'light', order: 0, createdAt: '' }],
      loaded: true,
    });

    useFavoritesStore.getState().reset();
    expect(useFavoritesStore.getState().favorites).toHaveLength(0);
    expect(useFavoritesStore.getState().loaded).toBe(false);

    // Tras el reset, el siguiente load vuelve a pedir al servidor (otro usuario).
    apiMock.get.mockResolvedValue([]);
    await useFavoritesStore.getState().load();
    expect(apiMock.get).toHaveBeenCalledTimes(1);
  });
});
