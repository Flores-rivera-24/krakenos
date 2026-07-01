import type { Camera, CameraSnapshot } from '@krakenos/types';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { CamerasPage } from '@/pages/CamerasPage';
import { useAuthStore } from '@/store/auth.store';
import { useToastStore } from '@/store/toast.store';

const CAMERAS: Camera[] = [
  { id: 'cam-entrada', name: 'Entrada', room: 'Exterior', model: 'X', online: true },
  { id: 'cam-garaje', name: 'Garaje', room: 'Sótano', model: 'X', online: false },
];

const SNAP: CameraSnapshot = {
  cameraId: 'cam-entrada',
  image: 'data:image/svg+xml;base64,AAAA',
  capturedAt: '2026-06-17T00:00:00.000Z',
};

function setRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'A', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

/** api.get responde la lista en `/cameras` y snapshots en el resto. */
function mockList(list: Camera[] = CAMERAS) {
  apiMock.get.mockImplementation((path: string) =>
    path === '/cameras' ? Promise.resolve(list) : Promise.resolve(SNAP),
  );
}

function toastMessages(): string[] {
  return useToastStore.getState().toasts.map((t) => t.message);
}

describe('CamerasPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post
      .mockReset()
      .mockResolvedValue({ id: 'new', name: 'Jardín', room: null, model: null, enabled: true });
    apiMock.patch.mockReset().mockResolvedValue({
      id: 'cam-entrada',
      name: 'Entrada renombrada',
      room: 'Exterior',
      model: 'X',
      enabled: true,
    });
    apiMock.del.mockReset().mockResolvedValue(undefined);
    useToastStore.setState({ toasts: [] });
    mockList();
    setRole('admin');
  });

  it('lista las cámaras con sus nombres', async () => {
    render(<CamerasPage />);
    await waitFor(() => expect(screen.getByText('Entrada')).toBeInTheDocument());
    expect(screen.getByText('Garaje')).toBeInTheDocument();
  });

  it('muestra el snapshot de la cámara online y "Sin señal" en la offline', async () => {
    render(<CamerasPage />);
    await waitFor(() => expect(screen.getByAltText('Cámara Entrada')).toBeInTheDocument());
    expect(screen.getByText('Sin señal')).toBeInTheDocument();
  });

  it('muestra un banner role="alert" si la carga falla (US-93)', async () => {
    apiMock.get.mockReset().mockRejectedValue(new Error('boom'));
    render(<CamerasPage />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/No se pudo conectar con el servidor/);
  });

  it('estado vacío para admin: enseña y ofrece añadir la primera (US-148)', async () => {
    mockList([]);
    render(<CamerasPage />);
    expect(
      await screen.findByText(/Aún no hay cámaras\. Añade la primera con su URL RTSP/),
    ).toBeInTheDocument();
    // Cabecera + estado vacío: al menos un botón "Añadir cámara".
    expect(screen.getAllByRole('button', { name: /Añadir cámara/ }).length).toBeGreaterThan(0);
  });

  it('estado vacío para viewer: mensaje suave, sin botón de añadir', async () => {
    setRole('viewer');
    mockList([]);
    render(<CamerasPage />);
    expect(await screen.findByText(/Pídele a un administrador/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Añadir cámara/ })).not.toBeInTheDocument();
  });

  it('un viewer no ve controles de gestión (añadir/editar/eliminar)', async () => {
    setRole('viewer');
    render(<CamerasPage />);
    await screen.findByText('Entrada');
    expect(screen.queryByRole('button', { name: /Añadir cámara/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar Entrada/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eliminar Entrada/ })).not.toBeInTheDocument();
  });

  it('un admin añade una cámara: slideover con ayuda RTSP → POST → toast', async () => {
    const user = userEvent.setup();
    render(<CamerasPage />);
    await screen.findByText('Entrada');

    await user.click(screen.getByRole('button', { name: /Añadir cámara/ }));
    const dialog = screen.getByRole('dialog');
    // Ayuda contextual: qué es una URL RTSP + aviso de privacidad.
    expect(
      within(dialog).getByRole('button', { name: /Qué es una URL RTSP/ }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/se guardan solo en tu servidor/)).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText('Nombre'), 'Jardín');
    await user.type(
      within(dialog).getByLabelText('URL RTSP'),
      'rtsp://u:p@10.0.0.9:554/s1',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Añadir cámara' }));

    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith(
        '/cameras',
        expect.objectContaining({ name: 'Jardín', rtspUrl: 'rtsp://u:p@10.0.0.9:554/s1' }),
      ),
    );
    await waitFor(() => expect(toastMessages()).toContain('Cámara añadida'));
  });

  it('un admin edita una cámara: rtspUrl en blanco = conservar → PATCH sin url', async () => {
    const user = userEvent.setup();
    render(<CamerasPage />);
    await screen.findByText('Entrada');

    await user.click(screen.getByRole('button', { name: 'Editar Entrada' }));
    const dialog = screen.getByRole('dialog');
    // Nombre precargado y placeholder que indica que se conserva la URL.
    expect(within(dialog).getByLabelText('Nombre')).toHaveValue('Entrada');
    expect(within(dialog).getByLabelText('URL RTSP')).toHaveAttribute(
      'placeholder',
      'dejar en blanco para conservar',
    );

    await user.clear(within(dialog).getByLabelText('Nombre'));
    await user.type(within(dialog).getByLabelText('Nombre'), 'Puerta');
    await user.click(within(dialog).getByRole('button', { name: 'Guardar cambios' }));

    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith('/cameras/cam-entrada', {
      name: 'Puerta',
      room: 'Exterior',
      model: 'X',
    }));
    await waitFor(() => expect(toastMessages()).toContain('Cámara actualizada'));
  });

  it('un admin elimina una cámara → DELETE + toast', async () => {
    const user = userEvent.setup();
    render(<CamerasPage />);
    await screen.findByText('Garaje');

    await user.click(screen.getByRole('button', { name: 'Eliminar Garaje' }));
    await waitFor(() => expect(apiMock.del).toHaveBeenCalledWith('/cameras/cam-garaje'));
    await waitFor(() => expect(toastMessages()).toContain('Cámara eliminada'));
  });

  it('si el alta falla, muestra el error en el panel y un toast (US-96)', async () => {
    apiMock.post.mockReset().mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    render(<CamerasPage />);
    await screen.findByText('Entrada');

    await user.click(screen.getByRole('button', { name: /Añadir cámara/ }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('Nombre'), 'X');
    await user.type(within(dialog).getByLabelText('URL RTSP'), 'rtsp://x');
    await user.click(within(dialog).getByRole('button', { name: 'Añadir cámara' }));

    await waitFor(() =>
      expect(within(dialog).getByText(/No se pudo conectar con el servidor/)).toBeInTheDocument(),
    );
    expect(toastMessages().some((m) => /No se pudo conectar con el servidor/.test(m))).toBe(true);
  });
});
