import type { PeopleResponse, PersonSummary } from '@krakenos/types';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => {
  // `getList` delega en `get` para que los mocks por ruta que ya existen
  // sigan valiendo tal cual: es el mismo GET, con la forma comprobada.
  const get = vi.fn();
  return {
    get,
    getList: vi.fn((path: string) => get(path)),
    post: vi.fn(),
    patch: vi.fn(),
    put: vi.fn(),
    del: vi.fn(),
  };
});
vi.mock('@/lib/api', () => ({
  api: apiMock,
  // El doble respeta la firma real `(status, body)`: con `status = 0` fijo, el
  // test tenia que parchearlo con `Object.assign` despues de construirlo, y un
  // doble que no se comporta como el original no prueba lo que dice probar.
  ApiRequestError: class ApiRequestError extends Error {
    constructor(
      readonly status: number,
      readonly body: { code: string; message: string },
    ) {
      super(body.message);
    }
  },
}));

import { ApiRequestError } from '@/lib/api';

import { ensureCatalog, setLocale } from '@/lib/i18n';
import { PeoplePage } from '@/pages/PeoplePage';
import { Toaster } from '@/components/ui/toast';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';

/**
 * Personas (US-240). Los tests asertan **los datos renderizados**, no que el
 * componente monte: un conteo invertido o una razón de bloqueo perdida son
 * exactamente los fallos que la cobertura sola no caza (gotcha «Cobertura ≠
 * aserción»). Los conteos van **asimétricos** por lo mismo.
 */

function person(over: Partial<PersonSummary> = {}): PersonSummary {
  return {
    userId: 'u-marta',
    name: 'Marta',
    role: 'kid',
    devices: [
      { id: 'd1', name: 'Tablet', online: true, blocked: false, reasons: [], pausedUntil: null },
      { id: 'd2', name: 'Móvil', online: true, blocked: false, reasons: [], pausedUntil: null },
      { id: 'd3', name: 'Portátil', online: false, blocked: false, reasons: [], pausedUntil: null },
    ],
    onlineCount: 2,
    blockedCount: 0,
    pausedUntil: null,
    bedtime: null,
    ...over,
  };
}

function response(over: Partial<PeopleResponse> = {}): PeopleResponse {
  return { people: [person()], fullHome: true, unassignedDevices: 0, ...over };
}

function asRole(role: 'admin' | 'kid') {
  useAuthStore.setState({
    user: { id: 'u-marta', email: 'a@b.c', displayName: 'A', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', expiresIn: 900 },
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <PeoplePage />
      <Toaster />
    </MemoryRouter>,
  );
}

describe('PeoplePage (US-240)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue(response());
    apiMock.post.mockReset().mockResolvedValue({ applied: 3, failed: 0 });
    apiMock.put.mockReset().mockResolvedValue({ applied: 3, failed: 0 });
    apiMock.del.mockReset().mockResolvedValue({ applied: 3, failed: 0 });
    useToastStore.setState({ toasts: [] });
    asRole('admin');
  });

  it('agrupa los dispositivos bajo la persona con sus conteos', async () => {
    renderPage();
    expect(await screen.findByText('Marta')).toBeInTheDocument();
    // 3 dispositivos, 2 en línea: asimétrico a propósito.
    expect(screen.getByText(/3 dispositivos/)).toBeInTheDocument();
    expect(screen.getByText(/2 en línea/)).toBeInTheDocument();
    expect(screen.getByText('Tablet')).toBeInTheDocument();
    expect(screen.getByText('Portátil')).toBeInTheDocument();
  });

  it('explica las tres formas de cortar internet', async () => {
    renderPage();
    expect(await screen.findByText('Las tres formas de cortar internet')).toBeInTheDocument();
    expect(screen.getByText('Pausa')).toBeInTheDocument();
    expect(screen.getByText('Horario')).toBeInTheDocument();
    expect(screen.getByText('Bloqueo')).toBeInTheDocument();
  });

  it('dice POR QUÉ está cortado cada dispositivo', async () => {
    apiMock.get.mockResolvedValue(
      response({
        people: [
          person({
            devices: [
              {
                id: 'd1',
                name: 'Tablet',
                online: true,
                blocked: true,
                reasons: ['schedule'],
                pausedUntil: null,
              },
              {
                id: 'd2',
                name: 'Móvil',
                online: true,
                blocked: true,
                reasons: ['manual'],
                pausedUntil: null,
              },
            ],
            onlineCount: 2,
            blockedCount: 2,
          }),
        ],
      }),
    );
    renderPage();
    expect(await screen.findByText('Por horario')).toBeInTheDocument();
    expect(screen.getByText('Bloqueado a mano')).toBeInTheDocument();
    expect(screen.getByText(/2 sin internet/)).toBeInTheDocument();
  });

  it('pausa a la persona entera con un toque', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Marta');

    await user.click(screen.getByRole('button', { name: /Pausar el internet de Marta 30/ }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/people/u-marta/pause', {
        minutes: 30,
      }),
    );
    expect(await screen.findByText('Internet pausado')).toBeInTheDocument();
  });

  it('reporta el parcial real en vez de decir «hecho»', async () => {
    apiMock.post.mockResolvedValue({ applied: 2, failed: 1 });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Marta');

    await user.click(screen.getByRole('button', { name: /Pausar el internet de Marta 30/ }));

    expect(
      await screen.findByText('2 de 3 dispositivos pausados. El resto se reintenta solo.'),
    ).toBeInTheDocument();
  });

  it('con pausa activa ofrece devolver el internet, no pausar más', async () => {
    const enUnaHora = new Date(Date.now() + 3_600_000).toISOString();
    apiMock.get.mockResolvedValue(response({ people: [person({ pausedUntil: enUnaHora })] }));
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(/Sin internet hasta las/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pausar el internet/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Devolver el internet a Marta' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/people/u-marta/resume'));
  });

  it('muestra la hora de dormir y a cuántos aparatos llega', async () => {
    apiMock.get.mockResolvedValue(
      response({
        people: [
          person({
            bedtime: {
              enabled: true,
              days: [1, 2, 3, 4, 5],
              startMinute: 22 * 60,
              endMinute: 7 * 60,
              appliedTo: 2,
            },
          }),
        ],
      }),
    );
    renderPage();
    expect(await screen.findByText(/Sin internet de 22:00 a 07:00/)).toBeInTheDocument();
    // Con 2 de 3 dispositivos cubiertos, la discrepancia se dice.
    expect(screen.getByText('Aplicada a 2 de 3 dispositivos.')).toBeInTheDocument();
  });

  it('guarda una hora de dormir nueva para toda la persona', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Marta');

    await user.click(screen.getByRole('button', { name: 'Poner hora de dormir' }));
    const panel = await screen.findByRole('dialog');
    await user.click(within(panel).getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(apiMock.put).toHaveBeenCalledWith('/people/u-marta/bedtime', {
        days: [1, 2, 3, 4, 5],
        startMinute: 1320,
        endMinute: 420,
        enabled: true,
      }),
    );
    expect(await screen.findByText('Hora de dormir guardada')).toBeInTheDocument();
  });

  it('un rol no admin ve solo lo suyo, sin controles de corte', async () => {
    asRole('kid');
    apiMock.get.mockResolvedValue(response({ fullHome: false }));
    renderPage();

    expect(await screen.findByText(/Solo ves tus dispositivos/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pausar el internet/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Poner hora de dormir' })).not.toBeInTheDocument();
    // Pero sí ve por qué no tiene internet: la información no se le oculta.
    expect(screen.getByText('Tablet')).toBeInTheDocument();
  });

  it('sin dueños asignados dice dónde se arregla, sin culpar al usuario', async () => {
    apiMock.get.mockResolvedValue(response({ people: [], unassignedDevices: 4 }));
    renderPage();

    expect(
      await screen.findByText('Todavía no hay dispositivos asignados a personas.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/4 dispositivos sin dueño/)).toBeInTheDocument();
  });

  it('el grupo «sin asignar» no ofrece acciones de persona', async () => {
    apiMock.get.mockResolvedValue(
      response({
        people: [person({ userId: null, name: 'Sin asignar', role: null, bedtime: null })],
      }),
    );
    renderPage();

    expect(await screen.findByText('Sin asignar')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Pausar el internet/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Poner hora de dormir' })).not.toBeInTheDocument();
  });

  it('un aparato sin nombre se llama «Dispositivo sin nombre», no con un trozo de su id', async () => {
    apiMock.get.mockResolvedValue(
      response({
        people: [
          person({
            devices: [
              {
                id: 'clx0b3lscb',
                name: null,
                online: true,
                blocked: false,
                reasons: [],
                pausedUntil: null,
              },
              {
                id: 'd2',
                name: 'Móvil',
                online: true,
                blocked: false,
                reasons: [],
                pausedUntil: null,
              },
            ],
          }),
        ],
      }),
    );
    renderPage();
    expect(await screen.findByText('Dispositivo sin nombre')).toBeInTheDocument();
    expect(screen.getByText('Móvil')).toBeInTheDocument();
    expect(screen.queryByText(/b3lscb/)).not.toBeInTheDocument();
  });

  describe('con la interfaz en inglés', () => {
    beforeAll(() => ensureCatalog('en'));
    afterEach(() => setLocale('es', { persist: false }));

    it('el aparato sin nombre y el grupo sin dueño salen en inglés', async () => {
      apiMock.get.mockResolvedValue(
        response({
          people: [
            person({
              userId: null,
              name: 'Sin asignar',
              role: null,
              bedtime: null,
              devices: [
                {
                  id: 'clx0b3lscb',
                  name: null,
                  online: true,
                  blocked: false,
                  reasons: [],
                  pausedUntil: null,
                },
              ],
            }),
          ],
        }),
      );
      setLocale('en', { persist: false });
      renderPage();
      expect(await screen.findByText('Unnamed device')).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Unassigned' })).toBeInTheDocument();
      expect(screen.queryByText('Sin asignar')).not.toBeInTheDocument();
    });
  });

  it('un 500 del agente se cuenta como fallo de carga, no como «no hay personas»', async () => {
    // Un 500 sin cuerpo legible es exactamente lo que construye `lib/api.ts`:
    // code UNKNOWN y `message` vacio, que es lo que hace caer a `describeError`
    // en su texto de reserva con el codigo de estado.
    const err = new ApiRequestError(500, { code: 'UNKNOWN', message: '' });
    apiMock.get.mockRejectedValue(err);
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo cargar la lista de personas (error 500).',
    );
    // Y NO se pinta el estado vacío, que diría que el hogar no tiene a nadie.
    expect(
      screen.queryByText('Todavía no hay dispositivos asignados a personas.'),
    ).not.toBeInTheDocument();
  });

  it('un fallo de red dice que es de red, no del servidor', async () => {
    apiMock.get.mockRejectedValue(new Error('boom'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo conectar con el servidor. Revisa tu conexión.',
    );
  });
});
