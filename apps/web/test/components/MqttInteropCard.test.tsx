import type { MqttState } from '@/lib/interop';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const interopMock = vi.hoisted(() => ({ getMqttState: vi.fn(), updateMqtt: vi.fn() }));
vi.mock('@/lib/interop', () => interopMock);

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/store/toast.store', () => ({ toast: toastMock }));

import { setLocale } from '@/lib/i18n';
import { MqttInteropCard } from '@/components/settings/MqttInteropCard';

const state: MqttState = {
  config: {
    enabled: false,
    url: 'mqtt://192.168.1.10:1883',
    username: 'ha',
    hasPassword: true,
    topicPrefix: 'krakenos',
    intervalSec: 30,
    discovery: false,
    control: false,
  },
  status: { enabled: false, connected: false, lastPublishAt: null, lastError: null },
};

describe('MqttInteropCard (US-174)', () => {
  beforeEach(() => {
    interopMock.getMqttState.mockReset().mockResolvedValue(state);
    interopMock.updateMqtt.mockReset().mockResolvedValue(state);
    toastMock.success.mockReset();
  });
  afterEach(() => setLocale('es', { persist: false }));

  it('carga la config y muestra el broker', async () => {
    render(<MqttInteropCard />);
    await waitFor(() => expect(interopMock.getMqttState).toHaveBeenCalled());
    expect((await screen.findByLabelText('Broker')) as HTMLInputElement).toHaveValue('mqtt://192.168.1.10:1883');
  });

  it('guarda la configuración', async () => {
    render(<MqttInteropCard />);
    await screen.findByLabelText('Broker');
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(interopMock.updateMqtt).toHaveBeenCalled());
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it('no envía contraseña si el campo se deja en blanco (conserva la guardada)', async () => {
    render(<MqttInteropCard />);
    await screen.findByLabelText('Broker');
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(interopMock.updateMqtt).toHaveBeenCalled());
    const body = interopMock.updateMqtt.mock.calls[0]?.[0];
    expect(body).not.toHaveProperty('password');
  });

  it('US-213: activa discovery y control por separado y los envía', async () => {
    render(<MqttInteropCard />);
    await screen.findByLabelText('Broker');
    fireEvent.click(screen.getByLabelText(/Descubrimiento de Home Assistant/));
    fireEvent.click(screen.getByLabelText(/Aceptar órdenes desde MQTT/));
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(interopMock.updateMqtt).toHaveBeenCalled());
    const body = interopMock.updateMqtt.mock.calls[0]?.[0];
    expect(body).toMatchObject({ discovery: true, control: true });
  });
});
