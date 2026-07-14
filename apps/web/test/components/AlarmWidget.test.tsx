import type { AlarmState } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { FakeApiError } = vi.hoisted(() => {
  class FakeApiError extends Error {
    constructor(
      readonly status: number,
      readonly body: { code: string; message: string },
    ) {
      super(body.message);
    }
  }
  return { FakeApiError };
});
vi.mock('@/lib/api', () => ({ ApiRequestError: FakeApiError, api: {} }));

const alarmMock = vi.hoisted(() => ({
  getAlarmState: vi.fn(),
  armAlarm: vi.fn(),
  disarmAlarm: vi.fn(),
}));
vi.mock('@/lib/alarm', () => alarmMock);
// El slideover de ajustes carga IoT/cámaras; no se ejercita aquí.
vi.mock('@/components/dashboard/AlarmSettingsSlideover', () => ({
  AlarmSettingsSlideover: () => null,
}));

import { AlarmWidget } from '@/components/dashboard/widgets/AlarmWidget';
import { useAuthStore } from '@/store/auth.store';

const disarmed: AlarmState = {
  phase: 'disarmed',
  mode: null,
  since: '2026-07-10T00:00:00.000Z',
  countdownEndsAt: null,
  triggeredBy: null,
};
const armed: AlarmState = { ...disarmed, phase: 'armed', mode: 'away' };

function setRole(role: 'admin' | 'member' | 'kid' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'A', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

describe('AlarmWidget (US-188)', () => {
  beforeEach(() => {
    localStorage.clear();
    alarmMock.getAlarmState.mockReset().mockResolvedValue(disarmed);
    alarmMock.armAlarm.mockReset().mockResolvedValue(armed);
    alarmMock.disarmAlarm.mockReset().mockResolvedValue(disarmed);
    setRole('member');
  });

  it('muestra el estado y arma en modo Fuera', async () => {
    const user = userEvent.setup();
    render(<AlarmWidget />);
    expect(await screen.findByText('Desarmada')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Armar (Fuera)' }));
    await waitFor(() => expect(alarmMock.armAlarm).toHaveBeenCalledWith('away'));
    await screen.findByText('Armada');
  });

  it('avisa (US-212) de que no sustituye una alarma certificada y se puede descartar', async () => {
    const user = userEvent.setup();
    render(<AlarmWidget />);
    await screen.findByText('Desarmada');
    expect(screen.getByText(/No sustituye una alarma certificada/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByText(/No sustituye una alarma certificada/)).not.toBeInTheDocument();
    expect(localStorage.getItem('krakenos.alarmDisclaimerAck')).toBe('1');
  });

  it('no repite el aviso si ya se descartó antes', async () => {
    localStorage.setItem('krakenos.alarmDisclaimerAck', '1');
    render(<AlarmWidget />);
    await screen.findByText('Desarmada');
    expect(screen.queryByText(/No sustituye una alarma certificada/)).not.toBeInTheDocument();
  });

  it('kid/viewer no ven los controles de armar', async () => {
    setRole('kid');
    render(<AlarmWidget />);
    await screen.findByText('Desarmada');
    expect(screen.queryByRole('button', { name: /Armar/ })).not.toBeInTheDocument();
    expect(screen.getByText(/no permite armar/)).toBeInTheDocument();
  });

  it('desarmar pide PIN si el servidor responde 401 y reintenta con él', async () => {
    const user = userEvent.setup();
    alarmMock.getAlarmState.mockResolvedValue(armed);
    // Primer intento (sin PIN) → 401; segundo (con PIN) → ok.
    alarmMock.disarmAlarm
      .mockRejectedValueOnce(new FakeApiError(401, { code: 'ALARM_BAD_PIN', message: 'x' }))
      .mockResolvedValueOnce(disarmed);
    render(<AlarmWidget />);
    await screen.findByText('Armada');

    await user.click(screen.getByRole('button', { name: 'Desarmar' }));
    // Aparece el campo de PIN.
    const pinField = await screen.findByLabelText('PIN de desarme');
    await user.type(pinField, '1234');
    await user.click(screen.getByRole('button', { name: 'Desarmar' }));

    await waitFor(() => expect(alarmMock.disarmAlarm).toHaveBeenLastCalledWith('1234'));
  });
});
