import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)), post: vi.fn(), del: vi.fn() };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { FavoriteButton } from '@/components/ui/favorite-button';
import { Toaster } from '@/components/ui/toast';
import { useFavoritesStore } from '@/store/favorites.store';
import { useToastStore } from '@/store/toast.store';

describe('FavoriteButton (US-170)', () => {
  beforeEach(() => {
    useFavoritesStore.setState({ favorites: [], loaded: true });
    useToastStore.setState({ toasts: [] });
    apiMock.post.mockReset();
    apiMock.del.mockReset();
  });

  it('refleja el estado no-fijado y al pulsar fija (POST) con aria-pressed', async () => {
    apiMock.post.mockResolvedValue({ id: 'f1', kind: 'iot', ref: 'light', order: 0, createdAt: '' });
    render(<FavoriteButton kind="iot" ref_="light" label="Luz salón" />);
    const btn = screen.getByRole('button', { name: /Fijar Luz salón/i });
    expect(btn).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(btn);
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/favorites', { kind: 'iot', ref: 'light' }));
    await waitFor(() => expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true'));
  });

  it('si la mutación falla, avisa por toast y no cambia el estado', async () => {
    apiMock.post.mockRejectedValue(new Error('boom'));
    render(
      <>
        <FavoriteButton kind="room" ref_="r1" label="Cocina" />
        <Toaster />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Fijar Cocina/i }));
    expect(await screen.findByText(/No se pudo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Fijar Cocina/i })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});
