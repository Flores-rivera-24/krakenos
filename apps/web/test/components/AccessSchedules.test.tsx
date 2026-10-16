import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  ApiRequestError: class ApiRequestError extends Error {},
}));

import { AccessSchedules } from '@/components/inventory/AccessSchedules';
import { changeLocale, setLocale } from '@/lib/i18n';
import { useToastStore } from '@/store/toast.store';

const SCHEDULE = {
  id: 's1',
  name: 'Noche',
  mac: 'aa:bb',
  enabled: true,
  days: [1],
  startMinute: 21 * 60,
  endMinute: 7 * 60,
  personId: null,
  createdAt: '',
};

describe('AccessSchedules — control parental (US-108)', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue([]);
    apiMock.post.mockReset().mockResolvedValue({});
    apiMock.patch.mockReset().mockResolvedValue({});
    apiMock.del.mockReset().mockResolvedValue(undefined);
    useToastStore.setState({ toasts: [] });
  });

  it('muestra el vacío y crea un horario con la franja por defecto', async () => {
    const user = userEvent.setup();
    render(<AccessSchedules mac="aa:bb" canEdit />);
    await screen.findByText(/Sin horarios/);

    await user.click(screen.getByRole('button', { name: 'Añadir horario' }));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
    const [url, body] = apiMock.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(url).toBe('/access/schedules');
    expect(body).toMatchObject({ mac: 'aa:bb', startMinute: 1260, endMinute: 420 });
    expect(body.days).toEqual([1, 2, 3, 4, 5]);
  });

  it('lista un horario y permite eliminarlo', async () => {
    apiMock.get.mockResolvedValue([SCHEDULE]);
    const user = userEvent.setup();
    render(<AccessSchedules mac="aa:bb" canEdit />);
    await screen.findByText('Noche');

    await user.click(screen.getByRole('button', { name: 'Eliminar Noche' }));
    // El primer clic solo arma: borrar un horario quita el corte de internet que protegía el aparato.
    expect(apiMock.del).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(apiMock.del).toHaveBeenCalledWith('/access/schedules/s1'));
  });

  it('cancelar la confirmación no borra el horario', async () => {
    apiMock.get.mockResolvedValue([SCHEDULE]);
    const user = userEvent.setup();
    render(<AccessSchedules mac="aa:bb" canEdit />);
    await screen.findByText('Noche');

    await user.click(screen.getByRole('button', { name: 'Eliminar Noche' }));
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(apiMock.del).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Eliminar Noche' })).toBeInTheDocument();
  });

  it('un horario que pone la persona no se edita desde el dispositivo (US-240)', async () => {
    apiMock.get.mockResolvedValue([{ ...SCHEDULE, name: 'Hora de dormir', personId: 'u-marta' }]);
    render(
      <MemoryRouter>
        <AccessSchedules mac="aa:bb" canEdit />
      </MemoryRouter>,
    );
    await screen.findByText('Hora de dormir');

    // Se dice de dónde viene y se manda al sitio donde SÍ se cambia…
    expect(screen.getByText(/lo pone la persona dueña/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Personas' })).toHaveAttribute('href', '/people');
    // …y no se ofrecen controles que lo descuadrarían del resto de sus aparatos.
    expect(screen.queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  });

  it('un viewer no ve controles de edición', async () => {
    apiMock.get.mockResolvedValue([SCHEDULE]);
    render(<AccessSchedules mac="aa:bb" canEdit={false} />);
    await screen.findByText('Noche');
    expect(screen.queryByRole('button', { name: 'Añadir horario' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument();
  });
});

/**
 * Las siete casillas del formulario solo enseñan la inicial, y las iniciales se
 * repiten («S»/«T» dos veces en inglés, «M» y «X» en español no, pero «Day S» sí).
 * El nombre accesible es el día completo; la inicial queda como texto visible.
 */
describe('AccessSchedules — nombres accesibles de las casillas de día', () => {
  const ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  const EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  beforeEach(() => {
    apiMock.get.mockReset().mockResolvedValue([]);
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    setLocale('es', { persist: false });
  });

  async function abrirFormulario() {
    const user = userEvent.setup();
    render(<AccessSchedules mac="aa:bb" canEdit />);
    await screen.findByText(/Sin horarios/);
    await user.click(screen.getByRole('button', { name: 'Añadir horario' }));
  }

  it('cada casilla se anuncia con el nombre completo de su día y ninguno se repite', async () => {
    await abrirFormulario();
    for (const dia of ES) {
      expect(screen.getByRole('button', { name: dia })).toHaveAttribute('aria-pressed');
    }
    // La inicial sigue siendo el texto visible de la casilla.
    expect(screen.getByRole('button', { name: 'Martes' })).toHaveTextContent(/^M$/);
    expect(screen.getByRole('button', { name: 'Sábado' })).toHaveTextContent(/^S$/);
  });

  it('en inglés también: Sunday/Saturday y Tuesday/Thursday no se confunden', async () => {
    await abrirFormulario();
    await changeLocale('en', { persist: false });
    await waitFor(() => {
      for (const dia of EN) {
        expect(screen.getByRole('button', { name: dia })).toBeInTheDocument();
      }
    });
    expect(screen.getByRole('button', { name: 'Tuesday' })).toHaveTextContent(/^T$/);
    expect(screen.getByRole('button', { name: 'Thursday' })).toHaveTextContent(/^T$/);
  });
});
