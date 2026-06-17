import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { verifySession } from '@/lib/session';
import { useAuthStore } from '@/store/auth.store';

const USER = { id: 'u1', email: 'a@b.c', displayName: 'A', role: 'admin' as const, createdAt: '', updatedAt: '' };
const TOKENS = { accessToken: 'acc', refreshToken: 'ref', expiresIn: 900 };

describe('verifySession', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, tokens: null });
    apiMock.get.mockReset();
  });

  it('devuelve false sin tokens y no llama a la API', async () => {
    expect(await verifySession()).toBe(false);
    expect(apiMock.get).not.toHaveBeenCalled();
  });

  it('con sesión válida refresca el usuario y devuelve true', async () => {
    useAuthStore.setState({ tokens: TOKENS });
    apiMock.get.mockResolvedValue(USER);

    expect(await verifySession()).toBe(true);
    expect(apiMock.get).toHaveBeenCalledWith('/auth/status');
    expect(useAuthStore.getState().user).toEqual(USER);
  });

  it('si la verificación falla limpia la sesión y devuelve false', async () => {
    useAuthStore.setState({ user: USER, tokens: TOKENS });
    apiMock.get.mockRejectedValue(new Error('401'));

    expect(await verifySession()).toBe(false);
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().tokens).toBeNull();
  });
});
