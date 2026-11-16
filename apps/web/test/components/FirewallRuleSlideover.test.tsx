import type { FirewallRule } from '@krakenos/types';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FirewallRuleSlideover } from '@/components/firewall/FirewallRuleSlideover';
import { api, ApiRequestError } from '@/lib/api';
import { changeLocale, setLocale } from '@/lib/i18n';

const REGLA: FirewallRule = {
  id: 'r1',
  name: 'Bloquear cámara',
  action: 'deny',
  protocol: 'any',
  source: null,
  destination: null,
  port: null,
  enabled: true,
  priority: 5,
  createdAt: '2026-06-17T00:00:00.000Z',
};

function montar() {
  return render(
    <FirewallRuleSlideover rule={REGLA} canEdit onClose={() => {}} onSaved={() => {}} />,
  );
}

describe('FirewallRuleSlideover', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setLocale('es', { persist: false });
  });

  it('un rechazo sin mensaje se pinta con el texto base, no vacío', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiRequestError(409, { code: 'X_DESCONOCIDO', message: '' }),
    );
    montar();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo guardar (error 409).');
  });

  it('en inglés el error del servidor se traduce por su código', async () => {
    vi.spyOn(api, 'patch').mockRejectedValue(
      new ApiRequestError(400, { code: 'VALIDATION', message: 'Revisa los datos' }),
    );
    await act(async () => {
      await changeLocale('en', { persist: false });
    });
    montar();
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Check the details and try again.'),
    );
  });

  it('en español conserva el copy original carácter a carácter', () => {
    montar();
    expect(screen.getByRole('dialog', { name: 'Regla: Bloquear cámara' })).toBeInTheDocument();
    expect(screen.getByText('Prioridad 5')).toBeInTheDocument();
    expect(screen.getByLabelText('Nombre')).toBeInTheDocument();
    expect(screen.getByLabelText('Origen')).toHaveAttribute('placeholder', 'IP/CIDR/MAC');
    expect(screen.getByLabelText('Puerto')).toHaveAttribute('placeholder', 'cualquiera');
    expect(screen.getByRole('option', { name: 'Bloquear' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Cualquiera' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'TCP' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeInTheDocument();
  });

  it('en inglés se traduce entero: título, subtítulo, etiquetas, opciones y botón', async () => {
    await act(async () => {
      await changeLocale('en', { persist: false });
    });
    montar();
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Rule: Bloquear cámara' })).toBeInTheDocument(),
    );
    expect(screen.getByText('Priority 5')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Source')).toBeInTheDocument();
    expect(screen.getByLabelText('Port')).toHaveAttribute('placeholder', 'any');
    expect(screen.getByRole('option', { name: 'Block' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Any' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.queryByText('Prioridad 5')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument();
  });
});
