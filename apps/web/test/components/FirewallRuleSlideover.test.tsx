import type { FirewallRule } from '@krakenos/types';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { FirewallRuleSlideover } from '@/components/firewall/FirewallRuleSlideover';
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
  afterEach(() => setLocale('es', { persist: false }));

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
