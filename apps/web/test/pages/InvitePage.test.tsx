import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type * as ReactRouter from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (orig) => {
  const actual = (await orig()) as typeof ReactRouter;
  return { ...actual, useNavigate: () => navigate };
});

const onboardingMock = vi.hoisted(() => ({
  previewInvitation: vi.fn(),
  acceptInvitation: vi.fn(),
}));
vi.mock('@/lib/onboarding', () => onboardingMock);

import { InvitePage } from '@/pages/InvitePage';
import { useAuthStore } from '@/store/auth.store';

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/invitacion/tok-123']}>
      <Routes>
        <Route path="/invitacion/:token" element={<InvitePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('InvitePage — aceptar una invitación (US-272)', () => {
  beforeEach(() => {
    navigate.mockClear();
    onboardingMock.previewInvitation.mockReset().mockResolvedValue({
      email: 'nuevo@krakenos.test',
      displayName: 'Persona Nueva',
      role: 'member',
      homeName: 'Casa de Test',
    });
    onboardingMock.acceptInvitation.mockReset().mockResolvedValue({
      user: { id: 'u1' },
      tokens: { accessToken: 'a', expiresIn: 900 },
    });
    useAuthStore.setState({ setSession: vi.fn() });
  });

  it('dice a quién invita y a qué hogar', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Te han invitado a Casa de Test' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/nuevo@krakenos.test/)).toBeInTheDocument();
  });

  /**
   * El punto de la historia: la contraseña la teclea quien la va a usar. Antes, el
   * admin la elegía y se la mandaba por un chat.
   */
  it('la contraseña la elige quien acepta, y entra con sesión', async () => {
    const setSession = vi.fn();
    useAuthStore.setState({ setSession });
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: /Te han invitado/ });
    await user.type(screen.getByLabelText('Contraseña'), 'la-mia-1234');
    await user.type(screen.getByLabelText('Confirmar contraseña'), 'la-mia-1234');
    await user.click(screen.getByRole('button', { name: 'Crear mi cuenta' }));

    await waitFor(() =>
      expect(onboardingMock.acceptInvitation).toHaveBeenCalledWith('tok-123', {
        password: 'la-mia-1234',
        displayName: 'Persona Nueva',
      }),
    );
    expect(setSession).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/', { replace: true });
  });

  it('no acepta si las dos contraseñas no coinciden', async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole('heading', { name: /Te han invitado/ });
    await user.type(screen.getByLabelText('Contraseña'), 'la-mia-1234');
    await user.type(screen.getByLabelText('Confirmar contraseña'), 'otra-cosa-99');
    await user.click(screen.getByRole('button', { name: 'Crear mi cuenta' }));

    expect(await screen.findByText('Las contraseñas no coinciden.')).toBeInTheDocument();
    expect(onboardingMock.acceptInvitation).not.toHaveBeenCalled();
  });

  /**
   * Un enlace muerto tiene que DECIRLO. Sin este estado se quedaba en el splash de
   * carga para siempre, que es la peor respuesta posible: parece que va a pasar algo.
   */
  it('un enlace usado o caducado lo dice, en vez de cargar eternamente', async () => {
    onboardingMock.previewInvitation.mockRejectedValue(new Error('404'));
    renderPage();
    expect(await screen.findByText('Este enlace ya no sirve')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ir a iniciar sesión' })).toBeInTheDocument();
  });
});
