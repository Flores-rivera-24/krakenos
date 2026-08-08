import type { IotDevice } from '@krakenos/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return { get, getList: vi.fn((path: string) => get(path)), patch: vi.fn(), put: vi.fn() };
});
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

const socketMock = vi.hoisted(() => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn() }));
vi.mock('@/lib/socket', () => ({ getSocket: () => socketMock }));

import { IotPage } from '@/pages/IotPage';
import { Toaster } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth.store';
import { useConnectionStore } from '@/store/connection.store';
import { useToastStore } from '@/store/toast.store';

const DEVICES: IotDevice[] = [
  {
    id: 'plug-tv',
    name: 'TV',
    kind: 'plug',
    room: 'Salón',
    reachable: true,
    on: true,
    brightness: null,
    color: null,
    readings: [],
  },
  {
    id: 'sensor-temp',
    name: 'Temperatura',
    kind: 'sensor',
    room: 'Salón',
    reachable: true,
    on: null,
    brightness: null,
    color: null,
    readings: [
      { metric: 'temperature', value: 21.5, unit: '°C' },
      { metric: 'humidity', value: 45, unit: '%' },
    ],
  },
  {
    id: 'light-hue',
    name: 'Foco Hue',
    kind: 'light',
    room: 'Salón',
    reachable: true,
    on: true,
    brightness: 80,
    color: { hex: '#ff8800', temperatureK: null },
    readings: [],
  },
];

/**
 * US-265. Las categorías que US-244 añadió al contrato: se listan aparte porque
 * la mayoría de los tests de arriba cuentan interruptores por posición y meterlas
 * en `DEVICES` los desplazaría.
 */
const CATEGORIAS_NUEVAS: IotDevice[] = [
  {
    id: 'cover-salon',
    name: 'Persiana salón',
    kind: 'cover',
    room: 'Salón',
    reachable: true,
    on: null,
    brightness: null,
    color: null,
    readings: [],
    position: 60,
  },
  {
    id: 'climate-salon',
    name: 'Termostato',
    kind: 'climate',
    room: 'Salón',
    reachable: true,
    on: null,
    brightness: null,
    color: null,
    readings: [{ metric: 'temperature', value: 20.5, unit: '°C' }],
    targetC: 21,
  },
  {
    id: 'lock-puerta',
    name: 'Cerradura',
    kind: 'lock',
    room: 'Entrada',
    reachable: true,
    on: null,
    brightness: null,
    color: null,
    readings: [],
    locked: true,
  },
  {
    id: 'smoke-cocina',
    name: 'Detector de humo',
    kind: 'smoke',
    room: 'Cocina',
    reachable: true,
    on: null,
    brightness: null,
    color: null,
    readings: [{ metric: 'smoke', value: 0, unit: '' }],
  },
  {
    id: 'contact-puerta',
    name: 'Sensor de puerta',
    kind: 'contact',
    room: 'Entrada',
    reachable: true,
    on: null,
    brightness: null,
    color: null,
    readings: [{ metric: 'contact', value: 0, unit: '' }],
  },
];

function setRole(role: 'admin' | 'member' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'A', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

describe('IotPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) =>
      path === '/iot/devices' ? Promise.resolve(DEVICES) : Promise.resolve([]),
    );
    apiMock.patch.mockReset().mockResolvedValue(DEVICES[0]);
    apiMock.put.mockReset().mockResolvedValue(undefined);
    socketMock.on.mockReset();
    socketMock.off.mockReset();
    useConnectionStore.setState({ status: 'connected' });
    useToastStore.setState({ toasts: [] });
  });

  it('lista dispositivos y muestra la lectura del sensor', async () => {
    setRole('admin');
    render(<IotPage />);
    await waitFor(() => expect(screen.getByText('TV')).toBeInTheDocument());
    expect(screen.getByText('Temperatura')).toBeInTheDocument();
    expect(screen.getByText('°C')).toBeInTheDocument();
  });

  it('un admin asigna un IoT a una habitación (PUT /rooms/assign, US-165)', async () => {
    setRole('admin');
    apiMock.get.mockImplementation((path: string) => {
      if (path === '/iot/devices') return Promise.resolve(DEVICES);
      if (path === '/rooms')
        return Promise.resolve([
          {
            id: 'r1',
            name: 'Salón',
            icon: 'living',
            order: 0,
            createdAt: '',
            deviceCount: 0,
            iotCount: 0,
            controllableCount: 0,
            onCount: 0,
            anyUnreachable: false,
            iotDeviceIds: [],
          },
        ]);
      return Promise.resolve([]);
    });
    render(<IotPage />);
    await screen.findByText('TV');

    const select = await screen.findByLabelText('Habitación', { selector: '#iot-room-plug-tv' });
    fireEvent.change(select, { target: { value: 'r1' } });
    await waitFor(() =>
      expect(apiMock.put).toHaveBeenCalledWith('/rooms/assign', {
        kind: 'iot',
        ref: 'plug-tv',
        roomId: 'r1',
      }),
    );
  });

  it('un admin puede alternar un enchufe (PATCH)', async () => {
    setRole('admin');
    render(<IotPage />);
    await screen.findByText('TV');

    // TV es el primer dispositivo, así que su switch es el primero.
    fireEvent.click(screen.getAllByRole('switch')[0]!);
    expect(apiMock.patch).toHaveBeenCalledWith('/iot/devices/plug-tv', { on: false });
  });

  it('un member también puede alternar (home.control, US-179) pero no asignar habitación', async () => {
    setRole('member');
    render(<IotPage />);
    await screen.findByText('TV');

    fireEvent.click(screen.getAllByRole('switch')[0]!);
    expect(apiMock.patch).toHaveBeenCalledWith('/iot/devices/plug-tv', { on: false });
    // La asignación a habitación sigue siendo gestión (solo admin).
    expect(screen.queryByLabelText(/Habitación/)).not.toBeInTheDocument();
  });

  it('toggle optimista: si el PATCH rechaza, el switch revierte y avisa (US-96)', async () => {
    setRole('admin');
    // Petición controlada: la dejamos en vuelo para observar el estado optimista.
    let reject!: (err: unknown) => void;
    apiMock.patch.mockReset().mockReturnValue(
      new Promise((_, r) => {
        reject = r;
      }),
    );
    render(
      <>
        <IotPage />
        <Toaster />
      </>,
    );
    await screen.findByText('TV');

    const sw = screen.getAllByRole('switch')[0]!; // TV (plug), on: true
    expect(sw).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(sw);
    // Optimista: se mueve YA, sin esperar al servidor.
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'false'));
    expect(apiMock.patch).toHaveBeenCalledWith('/iot/devices/plug-tv', { on: false });

    // La petición falla → revierte (no miente) y muestra un toast de error.
    reject(new Error('network down'));
    await waitFor(() => expect(sw).toHaveAttribute('aria-checked', 'true'));
    expect(await screen.findByText(/No se pudo conectar con el servidor/)).toBeInTheDocument();
  });

  it('un admin puede cambiar el color de una luz con color (PATCH)', async () => {
    setRole('admin');
    render(<IotPage />);
    await screen.findByText('Foco Hue');

    const picker = screen.getByLabelText('Color') as HTMLInputElement;
    fireEvent.input(picker, { target: { value: '#00ff00' } });
    expect(apiMock.patch).toHaveBeenCalledWith('/iot/devices/light-hue', {
      color: { hex: '#00ff00' },
    });
  });

  it('un viewer ve el aviso de solo lectura', async () => {
    setRole('viewer');
    render(<IotPage />);
    expect(await screen.findByText(/Solo lectura/)).toBeInTheDocument();
  });

  it('muestra un banner role="alert" si la carga falla (US-93)', async () => {
    setRole('admin');
    apiMock.get.mockReset().mockRejectedValue(new Error('boom'));
    render(<IotPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No se pudo conectar con el servidor/);
  });

  it('muestra el estado vacío honesto sin dispositivos y ofrece conectar (US-93/US-150)', async () => {
    setRole('admin');
    apiMock.get.mockReset().mockResolvedValue([]);
    render(
      <MemoryRouter>
        <IotPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/Aún no hay dispositivos IoT/)).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: /Conecta tu primera luz o enchufe/ });
    expect(cta).toHaveAttribute('href', '/connect');
  });

  it('marca los datos como obsoletos cuando el stream está caído (US-94)', async () => {
    setRole('admin');
    useConnectionStore.setState({ status: 'offline' });
    render(<IotPage />);
    await screen.findByText('TV');
    expect(screen.getByText('Datos obsoletos')).toBeInTheDocument();
  });

  it('sin caída del stream no marca obsoleto (US-94)', async () => {
    setRole('admin');
    render(<IotPage />);
    await screen.findByText('TV');
    expect(screen.queryByText('Datos obsoletos')).not.toBeInTheDocument();
  });
});

/**
 * US-265. Hoy Home Assistant podía mover una persiana **a través de** KrakenOS y
 * KrakenOS no: la API acepta `position`/`targetC` desde US-244 y los backends los
 * escriben desde US-247, pero la página solo los pintaba como texto.
 */
describe('IotPage · persianas y termostatos (US-265)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) =>
      path === '/iot/devices' ? Promise.resolve(CATEGORIAS_NUEVAS) : Promise.resolve([]),
    );
    apiMock.patch.mockReset().mockResolvedValue(CATEGORIAS_NUEVAS[0]);
    apiMock.put.mockReset().mockResolvedValue(undefined);
    socketMock.on.mockReset();
    socketMock.off.mockReset();
    useConnectionStore.setState({ status: 'connected' });
    useToastStore.setState({ toasts: [] });
  });

  it('mueve una persiana a una posición concreta (PATCH position)', async () => {
    setRole('admin');
    render(<IotPage />);
    await screen.findByText('Persiana salón');

    const slider = screen.getByLabelText('Posición de Persiana salón');
    expect(slider).toHaveValue('60');

    // Draft + commit, igual que el brillo: el arrastre no manda una petición por píxel.
    fireEvent.change(slider, { target: { value: '25' } });
    expect(apiMock.patch).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(apiMock.patch).toHaveBeenCalledWith('/iot/devices/cover-salon', { position: 25 });
  });

  it('abrir y cerrar van por `on`, que es el camino que funciona sin control de posición', async () => {
    setRole('admin');
    render(<IotPage />);
    await screen.findByText('Persiana salón');

    fireEvent.click(screen.getByLabelText('Abrir Persiana salón'));
    expect(apiMock.patch).toHaveBeenCalledWith('/iot/devices/cover-salon', { on: true });

    fireEvent.click(screen.getByLabelText('Cerrar Persiana salón'));
    expect(apiMock.patch).toHaveBeenCalledWith('/iot/devices/cover-salon', { on: false });
  });

  it('una persiana sin posición reportada NO pinta el deslizador, pero sí abrir/cerrar', async () => {
    setRole('admin');
    apiMock.get.mockImplementation((path: string) =>
      path === '/iot/devices'
        ? Promise.resolve([{ ...CATEGORIAS_NUEVAS[0]!, position: null }])
        : Promise.resolve([]),
    );
    render(<IotPage />);
    await screen.findByText('Persiana salón');

    // Un deslizador a 0 sobre un aparato que no publica su posición sería inventarse una medida.
    expect(screen.queryByLabelText('Posición de Persiana salón')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Abrir Persiana salón')).toBeInTheDocument();
  });

  it('sube y baja la consigna del termostato en pasos de medio grado (PATCH targetC)', async () => {
    setRole('admin');
    render(<IotPage />);
    await screen.findByText('Termostato');
    expect(screen.getByText('Objetivo 21 °C')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Subir la temperatura objetivo de Termostato'));
    expect(apiMock.patch).toHaveBeenCalledWith('/iot/devices/climate-salon', { targetC: 21.5 });

    fireEvent.click(screen.getByLabelText('Bajar la temperatura objetivo de Termostato'));
    expect(apiMock.patch).toHaveBeenCalledWith('/iot/devices/climate-salon', { targetC: 20.5 });
  });

  it('la consigna se manda SOLA: el borde rechaza `targetC` junto a `on` o `brightness`', async () => {
    setRole('admin');
    render(<IotPage />);
    await screen.findByText('Termostato');

    fireEvent.click(screen.getByLabelText('Subir la temperatura objetivo de Termostato'));
    const [, body] = apiMock.patch.mock.calls[0]!;
    expect(Object.keys(body as object)).toEqual(['targetC']);
  });

  it('no deja pasar de los límites del contrato (4-35 °C)', async () => {
    setRole('admin');
    apiMock.get.mockImplementation((path: string) =>
      path === '/iot/devices'
        ? Promise.resolve([
            { ...CATEGORIAS_NUEVAS[1]!, id: 'c-max', name: 'Tope alto', targetC: 35 },
            { ...CATEGORIAS_NUEVAS[1]!, id: 'c-min', name: 'Tope bajo', targetC: 4 },
          ])
        : Promise.resolve([]),
    );
    render(<IotPage />);
    await screen.findByText('Tope alto');

    // Deshabilitados en el extremo: pulsarlos produciría un 400 que el usuario no puede resolver.
    expect(screen.getByLabelText('Subir la temperatura objetivo de Tope alto')).toBeDisabled();
    expect(screen.getByLabelText('Bajar la temperatura objetivo de Tope alto')).toBeEnabled();
    expect(screen.getByLabelText('Bajar la temperatura objetivo de Tope bajo')).toBeDisabled();
    expect(screen.getByLabelText('Subir la temperatura objetivo de Tope bajo')).toBeEnabled();
  });

  it('un termostato sin consigna lo DICE en vez de estrenar un número inventado', async () => {
    setRole('admin');
    apiMock.get.mockImplementation((path: string) =>
      path === '/iot/devices'
        ? Promise.resolve([{ ...CATEGORIAS_NUEVAS[1]!, targetC: null }])
        : Promise.resolve([]),
    );
    render(<IotPage />);
    await screen.findByText('Termostato');

    expect(screen.getByText(/no informa de su temperatura objetivo/)).toBeInTheDocument();
    expect(
      screen.queryByLabelText('Subir la temperatura objetivo de Termostato'),
    ).not.toBeInTheDocument();
  });

  it('un member también opera persianas y termostatos (home.control, US-179)', async () => {
    setRole('member');
    render(<IotPage />);
    await screen.findByText('Persiana salón');

    fireEvent.click(screen.getByLabelText('Abrir Persiana salón'));
    expect(apiMock.patch).toHaveBeenCalledWith('/iot/devices/cover-salon', { on: true });
  });

  it('un viewer ve los controles deshabilitados, no ausentes', async () => {
    setRole('viewer');
    render(<IotPage />);
    await screen.findByText('Persiana salón');

    expect(screen.getByLabelText('Abrir Persiana salón')).toBeDisabled();
    expect(screen.getByLabelText('Posición de Persiana salón')).toBeDisabled();
    expect(screen.getByLabelText('Subir la temperatura objetivo de Termostato')).toBeDisabled();
  });

  it('⚠️ NI una cerradura, NI un detector de humo, NI un sensor de contacto pintan interruptor', async () => {
    setRole('admin');
    render(<IotPage />);
    await screen.findByText('Cerradura');

    // La página pintaba un interruptor para todo lo que no fuese `sensor`, así que
    // una cerradura ofrecía «Encender Cerradura». El contrato lo rechaza, pero un
    // control que no puede funcionar no debe existir — y menos ese
    // (`docs/adr-cerraduras.md`: la ausencia de la superficie ES la garantía).
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryByLabelText('Encender Cerradura')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Encender Detector de humo')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Encender Sensor de puerta')).not.toBeInTheDocument();
  });

  it('⚠️ una cerradura no ofrece NINGÚN control de escritura (adr-cerraduras)', async () => {
    setRole('admin');
    apiMock.get.mockImplementation((path: string) =>
      path === '/iot/devices' ? Promise.resolve([CATEGORIAS_NUEVAS[2]!]) : Promise.resolve([]),
    );
    render(<IotPage />);
    await screen.findByText('Cerradura');

    // Ni interruptor ni deslizador, y ningún botón que escriba en el aparato: los
    // únicos que quedan son el favorito (preferencia del usuario) y la ayuda de la
    // página, que no mandan nada a la cerradura.
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(screen.queryAllByRole('slider')).toHaveLength(0);
    const nombres = screen
      .queryAllByRole('button')
      .map((b) => b.getAttribute('aria-label') ?? b.textContent ?? '');
    expect(nombres).toEqual(['¿Qué es IoT?', 'Fijar Cerradura como favorito']);
  });

  it('la luz y el enchufe SÍ conservan su interruptor (guard de que el filtro no se pasó de listo)', async () => {
    setRole('admin');
    apiMock.get.mockImplementation((path: string) =>
      path === '/iot/devices' ? Promise.resolve(DEVICES) : Promise.resolve([]),
    );
    render(<IotPage />);
    await screen.findByText('TV');

    // Asimétrico a propósito: 2 conmutables (TV, Foco) de 3 dispositivos, así que
    // invertir la condición no da el mismo número.
    expect(screen.getAllByRole('switch')).toHaveLength(2);
  });
});
