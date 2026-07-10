import type { MatterBridgeState } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { MatterBridgeCard } from '@/components/settings/MatterBridgeCard';
import { Toaster } from '@/components/ui/toast';
import { useToastStore } from '@/store/toast.store';

function stateFixture(over: Partial<MatterBridgeState> = {}): MatterBridgeState {
  return {
    enabled: false,
    running: false,
    commissioned: false,
    fabricCount: 0,
    qrCode: null,
    qrDataUrl: null,
    manualPairingCode: null,
    endpoints: [],
    candidates: [
      { deviceId: 'plug-tv', name: 'TV', type: 'onoff', exposed: false },
      { deviceId: 'light-salon', name: 'Luz salón', type: 'dimmable', exposed: false },
    ],
    ...over,
  };
}

function renderCard(isAdmin = true) {
  return render(
    <>
      <MatterBridgeCard isAdmin={isAdmin} />
      <Toaster />
    </>,
  );
}

describe('MatterBridgeCard (US-171)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue(stateFixture());
    apiMock.put.mockReset();
    useToastStore.setState({ toasts: [] });
  });

  it('muestra el estado desactivado por defecto', async () => {
    renderCard();
    expect(await screen.findByText(/Puente Matter/)).toBeInTheDocument();
    expect(screen.getByText('Desactivado')).toBeInTheDocument();
  });

  it('un admin activa el puente', async () => {
    apiMock.put.mockResolvedValue(stateFixture({ enabled: true, running: true }));
    renderCard(true);
    const user = userEvent.setup();
    await screen.findByText(/Puente Matter/);
    await user.click(screen.getByRole('switch', { name: 'Activar el puente' }));
    await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith('/matter-bridge', { enabled: true }));
  });

  it('muestra el QR y el código manual cuando está activo', async () => {
    apiMock.get.mockResolvedValue(
      stateFixture({
        enabled: true,
        running: true,
        qrCode: 'MT:MOCK-3840-1',
        qrDataUrl: 'data:image/png;base64,AAAA',
        manualPairingCode: '3497-011-2332',
      }),
    );
    renderCard(true);
    expect(await screen.findByAltText(/QR de emparejamiento/)).toBeInTheDocument();
    expect(screen.getByText('3497-011-2332')).toBeInTheDocument();
  });

  it('un viewer ve el estado pero no puede togglear (controles deshabilitados)', async () => {
    apiMock.get.mockResolvedValue(stateFixture({ enabled: true, running: true }));
    renderCard(false);
    await screen.findByText(/Puente Matter/);
    expect(screen.getByRole('switch', { name: 'Activar el puente' })).toBeDisabled();
  });
});
