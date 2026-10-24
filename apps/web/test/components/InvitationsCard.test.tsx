import type { Invitation } from '@krakenos/types';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const onboardingMock = vi.hoisted(() => ({
  listInvitations: vi.fn(),
  listAccessRequests: vi.fn(),
  createInvitation: vi.fn(),
  decideAccessRequest: vi.fn(),
  revokeInvitation: vi.fn(),
}));
vi.mock('@/lib/onboarding', () => onboardingMock);

import { InvitationsCard } from '@/components/settings/InvitationsCard';
import { changeLocale, setLocale } from '@/lib/i18n';

const AHORA = new Date('2026-10-15T12:00:00Z');
const H = 3_600_000;

function invitacion(over: Partial<Invitation>): Invitation {
  return {
    id: 'i1',
    email: 'ana@casa.test',
    displayName: 'Ana',
    role: 'member',
    expiresAt: new Date(AHORA.getTime() + 24 * H).toISOString(),
    accountExpiresAt: null,
    usedAt: null,
    createdAt: AHORA.toISOString(),
    status: 'pending',
    ...over,
  };
}

describe('InvitationsCard: caducidad de una invitación', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(AHORA);
    onboardingMock.listAccessRequests.mockResolvedValue([]);
  });
  afterEach(() => {
    vi.useRealTimers();
    setLocale('es', { persist: false });
  });

  it('una invitación recién creada dice «Caduca en 24 h», no «hace un momento»', async () => {
    onboardingMock.listInvitations.mockResolvedValue([invitacion({})]);
    render(<InvitationsCard />);
    expect(await screen.findByText(/Caduca en 24 h/)).toBeInTheDocument();
    expect(screen.queryByText(/hace un momento/)).not.toBeInTheDocument();
  });

  it('en inglés: «Expires in 24 h»', async () => {
    await changeLocale('en', { persist: false });
    onboardingMock.listInvitations.mockResolvedValue([invitacion({})]);
    render(<InvitationsCard />);
    expect(await screen.findByText(/Expires in 24 h/)).toBeInTheDocument();
    expect(screen.queryByText(/just now/)).not.toBeInTheDocument();
  });

  it('una invitación ya caducada sigue hablando del pasado', async () => {
    onboardingMock.listInvitations.mockResolvedValue([
      invitacion({
        status: 'expired',
        expiresAt: new Date(AHORA.getTime() - 3 * H).toISOString(),
      }),
    ]);
    render(<InvitationsCard />);
    expect(await screen.findByText(/Caduca hace 3h/)).toBeInTheDocument();
  });
});

describe('InvitationsCard: con error no se pinta además el spinner', () => {
  it('muestra el fallo y no la línea de carga', async () => {
    onboardingMock.listInvitations.mockRejectedValue(new Error('red'));
    onboardingMock.listAccessRequests.mockResolvedValue([]);
    render(<InvitationsCard />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
