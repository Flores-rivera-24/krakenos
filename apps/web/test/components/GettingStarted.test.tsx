import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getIntegrations = vi.hoisted(() => vi.fn());
vi.mock('@/lib/integrations', () => ({ getIntegrations }));

import { GettingStarted } from '@/components/dashboard/GettingStarted';
import { useAuthStore } from '@/store/auth.store';

function renderCard() {
  return render(
    <MemoryRouter>
      <GettingStarted />
    </MemoryRouter>,
  );
}

describe('GettingStarted — primeros pasos (US-145)', () => {
  beforeEach(() => {
    localStorage.clear();
    getIntegrations.mockReset().mockResolvedValue([
      { domain: 'driver', source: 'env' },
      { domain: 'iot', source: 'env' },
    ]);
    useAuthStore.setState({ user: { id: 'u1', email: 'a@k.test', role: 'admin' } } as never);
  });

  it('muestra la bienvenida y los pasos al administrador', async () => {
    renderCard();
    expect(await screen.findByText('¡Bienvenido a KrakenOS!')).toBeInTheDocument();
    expect(screen.getByText('Conecta tu red')).toBeInTheDocument();
    expect(screen.getByText('Añade una luz o un enchufe')).toBeInTheDocument();
  });

  it('no se muestra a un viewer', () => {
    useAuthStore.setState({ user: { id: 'u2', email: 'v@k.test', role: 'viewer' } } as never);
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it('se puede descartar y no reaparece (localStorage)', async () => {
    renderCard();
    fireEvent.click(await screen.findByLabelText('Descartar primeros pasos'));
    expect(screen.queryByText('¡Bienvenido a KrakenOS!')).not.toBeInTheDocument();
    expect(localStorage.getItem('krakenos-onboarding-dismissed')).toBe('1');
  });

  it('marca "hecho" el paso ya configurado y se oculta si red+IoT están conectados', async () => {
    getIntegrations.mockResolvedValue([
      { domain: 'driver', source: 'db' },
      { domain: 'iot', source: 'env' },
    ]);
    renderCard();
    // router hecho, iot no → sigue visible, con "hecho" en el paso de red.
    expect(await screen.findByText('· hecho')).toBeInTheDocument();

    // Ahora ambos conectados → la tarjeta desaparece.
    getIntegrations.mockResolvedValue([
      { domain: 'driver', source: 'db' },
      { domain: 'iot', source: 'db' },
    ]);
    const { container } = renderCard();
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
