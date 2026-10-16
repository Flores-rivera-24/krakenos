import type { Invitation } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const onboarding = vi.hoisted(() => ({
  listInvitations: vi.fn(),
  listAccessRequests: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
  decideAccessRequest: vi.fn(),
}));
vi.mock('@/lib/onboarding', () => onboarding);

import { InvitationsCard } from '@/components/settings/InvitationsCard';

const INVITACION: Invitation = {
  id: 'i1',
  email: 'marta@casa.test',
  displayName: 'Marta',
  role: 'member',
  status: 'pending',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  accountExpiresAt: null,
  usedAt: null,
};

describe('InvitationsCard', () => {
  beforeEach(() => {
    for (const fn of Object.values(onboarding)) fn.mockReset();
    onboarding.listInvitations.mockResolvedValue([INVITACION]);
    onboarding.listAccessRequests.mockResolvedValue([]);
    onboarding.revokeInvitation.mockResolvedValue(undefined);
  });

  it('revocar una invitación pide confirmar: el primer clic no la invalida', async () => {
    const user = userEvent.setup();
    render(<InvitationsCard />);
    await screen.findByText('marta@casa.test');

    await user.click(screen.getByRole('button', { name: 'Revocar' }));
    // Revocar mata el enlace para siempre: un clic suelto no basta.
    expect(onboarding.revokeInvitation).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(onboarding.revokeInvitation).toHaveBeenCalledWith('i1'));
  });

  it('cancelar la confirmación deja la invitación como estaba', async () => {
    const user = userEvent.setup();
    render(<InvitationsCard />);
    await screen.findByText('marta@casa.test');

    await user.click(screen.getByRole('button', { name: 'Revocar' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onboarding.revokeInvitation).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Revocar' })).toBeInTheDocument();
  });

  it('el botón que oculta el enlace recién creado tiene nombre accesible', async () => {
    const user = userEvent.setup();
    onboarding.createInvitation.mockResolvedValue({
      invitation: INVITACION,
      path: '/invite?token=abc',
    });
    render(<InvitationsCard />);
    await screen.findByText('marta@casa.test');

    await user.type(screen.getByLabelText('Correo electrónico'), 'nuevo@casa.test');
    await user.type(screen.getByLabelText('Nombre'), 'Nuevo');
    await user.click(screen.getByRole('button', { name: 'Crear invitación' }));

    const ocultar = await screen.findByRole('button', { name: 'Ocultar el enlace' });
    await user.click(ocultar);
    expect(screen.queryByRole('button', { name: 'Ocultar el enlace' })).not.toBeInTheDocument();
  });
});
