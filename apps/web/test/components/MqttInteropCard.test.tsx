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
    pauseControl: false,
  },
  status: { enabled: false, connected: false, lastPublishAt: null, lastError: null },
};

/** El formulario nace deshabilitado: se espera a que la lectura lo habilite. */
const cargado = () => waitFor(() => expect(screen.getByLabelText('Broker')).toBeEnabled());

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
    await cargado();
    expect(screen.getByLabelText('Broker') as HTMLInputElement).toHaveValue(
      'mqtt://192.168.1.10:1883',
    );
  });

  it('guarda la configuración', async () => {
    render(<MqttInteropCard />);
    await cargado();
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(interopMock.updateMqtt).toHaveBeenCalled());
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it('no envía contraseña si el campo se deja en blanco (conserva la guardada)', async () => {
    render(<MqttInteropCard />);
    await cargado();
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(interopMock.updateMqtt).toHaveBeenCalled());
    const body = interopMock.updateMqtt.mock.calls[0]?.[0];
    expect(body).not.toHaveProperty('password');
  });

  it('US-213: activa discovery y control por separado y los envía', async () => {
    render(<MqttInteropCard />);
    await cargado();
    fireEvent.click(screen.getByLabelText(/Descubrimiento de Home Assistant/));
    fireEvent.click(screen.getByLabelText(/Aceptar órdenes desde MQTT/));
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    await waitFor(() => expect(interopMock.updateMqtt).toHaveBeenCalled());
    const body = interopMock.updateMqtt.mock.calls[0]?.[0];
    expect(body).toMatchObject({ discovery: true, control: true });
  });

  it('si la lectura falla, dice el fallo, no deja guardar y reintentar recupera', async () => {
    interopMock.getMqttState.mockReset().mockRejectedValueOnce(new Error('boom'));
    interopMock.getMqttState.mockResolvedValue(state);
    render(<MqttInteropCard />);
    expect(
      await screen.findByText(
        'No se pudo cargar la configuración de MQTT; no se puede guardar hasta leerla.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar/ })).toBeDisabled();
    expect(screen.getByLabelText('Broker')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    expect(interopMock.updateMqtt).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() => expect(screen.getByLabelText('Broker')).toBeEnabled());
    expect(screen.getByLabelText('Broker')).toHaveValue('mqtt://192.168.1.10:1883');
    expect(screen.getByRole('button', { name: /Guardar/ })).toBeEnabled();
  });

  it('una respuesta sin config ({}) cuenta como fallo, no como formulario vacío', async () => {
    interopMock.getMqttState.mockReset().mockResolvedValue({});
    render(<MqttInteropCard />);
    expect(
      await screen.findByText(
        'No se pudo cargar la configuración de MQTT; no se puede guardar hasta leerla.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Guardar/ }));
    expect(interopMock.updateMqtt).not.toHaveBeenCalled();
  });

  it('el icono del título es de 20 px y se oculta a los lectores (el título ya nombra la tarjeta)', async () => {
    const { container } = render(<MqttInteropCard />);
    await waitFor(() =>
      expect(container.querySelector('svg.lucide-radio.text-kr-accent')).not.toBeNull(),
    );
    const icono = container.querySelector('svg.lucide-radio.text-kr-accent')!;
    expect(icono).toHaveClass('h-5', 'w-5');
    expect(icono).toHaveAttribute('aria-hidden', 'true');
  });
});
