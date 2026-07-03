import type { Device } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class ApiRequestError extends Error {} }));

import { PauseInternet } from '@/components/inventory/PauseInternet';
import { useToastStore } from '@/store/toast.store';

function device(over: Partial<Device> = {}): Device {
  return {
    id: 'd',
    mac: 'aa:bb',
    ip: '1.2.3.4',
    hostname: null,
    label: null,
    notes: null,
    vendor: null,
    type: 'computer',
    isBlocked: false,
    pausedUntil: null,
    online: true,
    vlanTag: null,
    sources: ['arp'],
    firstSeen: '',
    lastSeen: '',
    ...over,
  };
}

describe('PauseInternet (US-111)', () => {
  beforeEach(() => {
    apiMock.post.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  it('pausa el internet al pulsar una duración', async () => {
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    apiMock.post.mockResolvedValue({ pausedUntil: future });
    const user = userEvent.setup();
    render(<PauseInternet device={device()} canEdit />);

    await user.click(screen.getByRole('button', { name: '30 min' }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/access/pause', { mac: 'aa:bb', minutes: 30 }),
    );
    expect(await screen.findByText(/Internet pausado hasta/)).toBeInTheDocument();
  });

  it('muestra el estado pausado y permite reanudar', async () => {
    apiMock.post.mockResolvedValue(undefined);
    const future = new Date(Date.now() + 30 * 60_000).toISOString();
    const user = userEvent.setup();
    render(<PauseInternet device={device({ pausedUntil: future })} canEdit />);

    expect(screen.getByText(/Internet pausado hasta/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reanudar' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/access/resume', { mac: 'aa:bb' }));
  });

  it('un viewer sin pausa activa no ve controles', () => {
    const { container } = render(<PauseInternet device={device()} canEdit={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
