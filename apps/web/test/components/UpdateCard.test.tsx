import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class ApiRequestError extends Error {} }));

import { UpdateCard } from '@/components/settings/UpdateCard';

describe('UpdateCard — comprobación de actualizaciones (US-116)', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
  });

  it('muestra la versión instalada y avisa de una actualización disponible', async () => {
    apiMock.get.mockResolvedValue({
      enabled: true,
      current: '1.0.0',
      latest: '1.2.0',
      updateAvailable: true,
    });
    render(<UpdateCard />);
    await screen.findByText('1.0.0');
    expect(await screen.findByText(/Actualización disponible/)).toBeInTheDocument();
    expect(screen.getByText('1.2.0')).toBeInTheDocument();
  });

  it('indica que estás al día', async () => {
    apiMock.get.mockResolvedValue({
      enabled: true,
      current: '1.2.0',
      latest: '1.2.0',
      updateAvailable: false,
    });
    render(<UpdateCard />);
    expect(await screen.findByText(/Estás al día/)).toBeInTheDocument();
  });

  it('muestra desactivada cuando no hay repo configurado', async () => {
    apiMock.get.mockResolvedValue({
      enabled: false,
      current: '1.0.0',
      latest: null,
      updateAvailable: false,
    });
    render(<UpdateCard />);
    expect(await screen.findByText(/desactivada/)).toBeInTheDocument();
  });
});
