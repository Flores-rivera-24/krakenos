import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { bootstrapSession } from '@/lib/session';
import { useAuthStore } from '@/store/auth.store';

const USER = { id: 'u1', email: 'a@b.c', displayName: 'A', role: 'admin' as const, createdAt: '', updatedAt: '' };

describe('bootstrapSession (US-91)', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, tokens: null });
    apiMock.get.mockReset();
  });

  it('sin cookie de refresh válida devuelve false y no pide el usuario', async () => {
    // refresh() falla (no hay cookie httpOnly) → no se llega a /auth/status.
    useAuthStore.setState({ refresh: vi.fn().mockResolvedValue(false) });
    expect(await bootstrapSession()).toBe(false);
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('con cookie válida refresca el access y carga el usuario', async () => {
    useAuthStore.setState({ refresh: vi.fn().mockResolvedValue(true) });
    apiMock.get.mockResolvedValue(USER);

    expect(await bootstrapSession()).toBe(true);
    expect(apiMock.get).toHaveBeenCalledWith('/auth/status');
    expect(useAuthStore.getState().user).toEqual(USER);
  });

  it('si /auth/status falla tras el refresh, limpia la sesión y devuelve false', async () => {
    useAuthStore.setState({ user: USER, refresh: vi.fn().mockResolvedValue(true) });
    apiMock.get.mockRejectedValue(new Error('401'));

    expect(await bootstrapSession()).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().tokens).toBeNull();
  });
});
