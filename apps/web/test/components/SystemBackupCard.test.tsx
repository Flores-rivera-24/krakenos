import type { AutoBackupStatus } from '@krakenos/types';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/store/toast.store', () => ({ toast: toastMock }));

import { SystemBackupCard } from '@/components/settings/SystemBackupCard';

const OFF: AutoBackupStatus = {
  frequency: 'off',
  retention: 7,
  passphraseSet: false,
  count: 0,
  totalBytes: 0,
  lastBackupAt: null,
  lastBackupBytes: null,
  lastError: null,
  stale: false,
};

/**
 * Copias automáticas en la UI (US-233 / AUD3-21). Lo que importa que no se rompa:
 * que el aviso de «no hay copia reciente» se vea, que la contraseña generada se
 * muestre con la advertencia de llevarla fuera del servidor, y que sin contraseña no
 * se pueda lanzar una copia (fallaría).
 */
describe('SystemBackupCard — copias automáticas', () => {
  beforeEach(() => {
    apiMock.get.mockReset();
    apiMock.post.mockReset();
    apiMock.patch.mockReset();
    toastMock.success.mockReset();
    toastMock.error.mockReset();
  });

  it('muestra el estado y deja programar la frecuencia', async () => {
    apiMock.get.mockResolvedValue(OFF);
    render(<SystemBackupCard />);

    const select = await screen.findByLabelText('Frecuencia');
    expect(select).toHaveValue('off');
    apiMock.patch.mockResolvedValue({});
    fireEvent.change(select, { target: { value: 'daily' } });
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/system/settings', {
        key: 'autoBackupFrequency',
        value: 'daily',
      }),
    );
  });

  it('sin contraseña no se puede copiar ahora', async () => {
    apiMock.get.mockResolvedValue(OFF);
    render(<SystemBackupCard />);
    const btn = await screen.findByRole('button', { name: 'Copiar ahora' });
    expect(btn).toBeDisabled();
  });

  it('genera la contraseña y avisa de guardarla FUERA del servidor', async () => {
    apiMock.get.mockResolvedValue(OFF);
    apiMock.post.mockResolvedValue({ passphraseSet: true, generated: 'contrasena-generada-1' });
    render(<SystemBackupCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Generar contraseña' }));
    await waitFor(() =>
      expect(apiMock.post).toHaveBeenCalledWith('/system/backup/auto/passphrase', {}),
    );
    expect(await screen.findByText('contrasena-generada-1')).toBeInTheDocument();
    // La advertencia es parte del producto: la copia y su contraseña en el mismo
    // aparato no protegen de que ese aparato muera.
    expect(screen.getByText(/fuera del servidor/i)).toBeInTheDocument();
  });

  it('la contraseña generada se puede copiar', async () => {
    apiMock.get.mockResolvedValue(OFF);
    apiMock.post.mockResolvedValue({ passphraseSet: true, generated: 'contrasena-generada-1' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<SystemBackupCard />);
    fireEvent.click(await screen.findByRole('button', { name: 'Generar contraseña' }));
    await screen.findByText('contrasena-generada-1');
    fireEvent.click(screen.getByRole('button', { name: /copiar$/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('contrasena-generada-1'));
  });

  it('cambiar la frecuencia avisa con «Cambios guardados.»', async () => {
    apiMock.get.mockResolvedValue(OFF);
    apiMock.patch.mockResolvedValue({});
    render(<SystemBackupCard />);
    fireEvent.change(await screen.findByLabelText('Frecuencia'), { target: { value: 'weekly' } });
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Cambios guardados.'));
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });

  it('la retención solo guarda si el valor cambió', async () => {
    apiMock.get.mockResolvedValue(OFF);
    apiMock.patch.mockResolvedValue({});
    render(<SystemBackupCard />);
    const keep = await screen.findByLabelText(/copias que se conservan/i);
    fireEvent.blur(keep);
    expect(apiMock.patch).not.toHaveBeenCalled();
    fireEvent.change(keep, { target: { value: '10' } });
    fireEvent.blur(keep);
    await waitFor(() =>
      expect(apiMock.patch).toHaveBeenCalledWith('/system/settings', {
        key: 'autoBackupRetention',
        value: '10',
      }),
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Cambios guardados.'));
  });

  it('avisa cuando no hay copia reciente (stale)', async () => {
    apiMock.get.mockResolvedValue({
      ...OFF,
      frequency: 'daily',
      passphraseSet: true,
      stale: true,
    });
    render(<SystemBackupCard />);
    expect(await screen.findByText(/No hay una copia reciente/i)).toBeInTheDocument();
  });

  it('muestra el error de la última copia automática', async () => {
    apiMock.get.mockResolvedValue({
      ...OFF,
      frequency: 'daily',
      passphraseSet: true,
      lastError: 'disco lleno',
    });
    render(<SystemBackupCard />);
    expect(await screen.findByText(/La última copia automática falló/i)).toBeInTheDocument();
    expect(screen.getByText('disco lleno')).toBeInTheDocument();
  });

  it('«copiar ahora» refresca el estado y avisa del resultado', async () => {
    apiMock.get.mockResolvedValue({ ...OFF, frequency: 'daily', passphraseSet: true });
    apiMock.post.mockResolvedValue({
      ...OFF,
      frequency: 'daily',
      passphraseSet: true,
      count: 1,
      totalBytes: 2048,
      lastBackupAt: '2026-07-29T03:00:00.000Z',
    });
    render(<SystemBackupCard />);

    fireEvent.click(await screen.findByRole('button', { name: 'Copiar ahora' }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith('/system/backup/auto/run'));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith('Copia creada'));
    expect(await screen.findByText(/1 copia en disco/)).toBeInTheDocument();
  });
});

/**
 * Los dos campos «confirmar» de la tarjeta (contraseña de la copia y palabra de la
 * restauración) compartían `id="bk-confirm"`: con un id repetido `htmlFor` resuelve al
 * primero y el campo de restaurar se quedaba sin nombre accesible.
 */
describe('SystemBackupCard — nombres accesibles', () => {
  it('no repite ningún id y el campo de confirmar la restauración tiene nombre', async () => {
    apiMock.get.mockResolvedValue(OFF);
    const { container } = render(<SystemBackupCard />);
    await screen.findByLabelText('Frecuencia');

    const ids = Array.from(container.querySelectorAll('[id]')).map((el) => el.id);
    expect(ids.length).toBeGreaterThan(5);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);

    // El nombre sale del <label> real: «Para continuar, escribe RESTAURAR».
    const campo = screen.getByRole('textbox', { name: /Para continuar, escribe\s+RESTAURAR/ });
    expect(campo).toHaveAttribute('id', 'bk-restore-confirm');
    // Y el otro «Confirmar» sigue siendo el de la contraseña de la copia.
    expect(screen.getByLabelText('Confirmar contraseña de la copia')).toHaveAttribute(
      'type',
      'password',
    );
  });
});

describe('SystemBackupCard: las copias automáticas que no se pudieron leer', () => {
  it('la sección se queda, lo dice y reintenta', async () => {
    apiMock.get.mockReset().mockRejectedValueOnce(new Error('red'));
    apiMock.get.mockResolvedValue(OFF);
    render(<SystemBackupCard />);

    expect(
      await screen.findByText('No se pudo leer el estado de las copias automáticas.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    await waitFor(() =>
      expect(
        screen.queryByText('No se pudo leer el estado de las copias automáticas.'),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByLabelText(/Frecuencia/i)).toBeInTheDocument();
  });
});

describe('SystemBackupCard: recarga fallida con el estado ya leído', () => {
  it('conserva el estado y lo marca como viejo', async () => {
    apiMock.get.mockReset().mockResolvedValueOnce(OFF);
    apiMock.get.mockRejectedValue(new Error('red'));
    apiMock.patch.mockReset().mockResolvedValue({});
    render(<SystemBackupCard />);

    const select = await screen.findByLabelText(/Frecuencia/i);
    expect(screen.queryByText('Datos obsoletos')).not.toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'daily' } });

    expect(await screen.findByText('Datos obsoletos')).toBeInTheDocument();
    expect(screen.getByLabelText(/Frecuencia/i)).toBeInTheDocument();
    expect(
      screen.queryByText('No se pudo leer el estado de las copias automáticas.'),
    ).not.toBeInTheDocument();
  });
});
