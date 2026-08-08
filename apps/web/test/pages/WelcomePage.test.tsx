import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock }));

import { WelcomePage } from '@/pages/WelcomePage';

function renderPage() {
  return render(
    <MemoryRouter>
      <WelcomePage />
    </MemoryRouter>,
  );
}

describe('WelcomePage — portada pública (US-266)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue({ needsSetup: false });
  });

  it('presenta qué es la instalación y los tres reclamos', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Tu red deja de ser una caja negra.' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Corre en tu casa')).toBeInTheDocument();
    expect(screen.getByText('Sin suscripción')).toBeInTheDocument();
    expect(screen.getByText('Código abierto')).toBeInTheDocument();
  });

  /**
   * El motivo por el que la portada existe: antes, quien llegaba a una instalación
   * recién montada veía un login que no podía superar y ninguna pista de que lo
   * que le tocaba era el asistente.
   */
  it('sin administrador, la acción principal es crearlo y lleva al asistente', async () => {
    apiMock.get.mockResolvedValue({ needsSetup: true });
    renderPage();

    const cta = await screen.findByRole('link', { name: /Crear administrador/ });
    expect(cta).toHaveAttribute('href', '/setup');
    expect(screen.getByText('Esta instalación todavía no tiene administrador.')).toBeInTheDocument();
    // Y no ofrece entrar: no hay cuenta con la que hacerlo.
    expect(screen.queryByRole('link', { name: /Entrar/ })).not.toBeInTheDocument();
  });

  it('con la instalación ya configurada, la acción principal es entrar', async () => {
    renderPage();
    const cta = await screen.findByRole('link', { name: /Entrar/ });
    expect(cta).toHaveAttribute('href', '/login');
    expect(screen.queryByRole('link', { name: /Crear administrador/ })).not.toBeInTheDocument();
  });

  /**
   * Si el agente no responde no se puede afirmar ni negar que haga falta el
   * asistente. Se ofrece «Entrar», que es la acción que no rompe nada si resulta
   * ser la equivocada: mandar al asistente a una instalación ya configurada
   * termina en un 409 y un callejón.
   */
  it('si no se puede consultar el estado, sigue ofreciendo entrar', async () => {
    apiMock.get.mockRejectedValue(new Error('agente caído'));
    renderPage();
    expect(await screen.findByRole('link', { name: /Entrar/ })).toHaveAttribute('href', '/login');
  });
});
