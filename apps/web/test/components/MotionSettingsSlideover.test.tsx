import type { Camera, CameraMotionConfig } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const camerasMock = vi.hoisted(() => ({
  getMotionConfig: vi.fn(),
  updateMotionConfig: vi.fn(),
}));
vi.mock('@/lib/cameras', () => camerasMock);

import { MotionSettingsSlideover } from '@/components/cameras/MotionSettingsSlideover';
import { useToastStore } from '@/store/toast.store';

const CAM: Camera = { id: 'cam-1', name: 'Entrada', room: null, model: null, online: true };
const CONFIG: CameraMotionConfig = {
  cameraId: 'cam-1',
  enabled: false,
  sensitivity: 'medium',
  cooldownSec: 60,
  record: false,
  arming: { mode: 'always' },
};

describe('MotionSettingsSlideover (US-186)', () => {
  beforeEach(() => {
    camerasMock.getMotionConfig.mockReset().mockResolvedValue(CONFIG);
    camerasMock.updateMotionConfig.mockReset().mockResolvedValue({ ...CONFIG, enabled: true });
    useToastStore.setState({ toasts: [] });
  });

  it('carga la config actual y la muestra', async () => {
    render(<MotionSettingsSlideover camera={CAM} onClose={() => {}} />);
    await waitFor(() => expect(camerasMock.getMotionConfig).toHaveBeenCalledWith('cam-1'));
    expect(await screen.findByLabelText('Detectar movimiento')).not.toBeChecked();
  });

  it('guarda los cambios (habilita + sensibilidad) vía PUT', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<MotionSettingsSlideover camera={CAM} onClose={onClose} />);
    await screen.findByLabelText('Detectar movimiento');

    await user.click(screen.getByLabelText('Detectar movimiento'));
    await user.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() =>
      expect(camerasMock.updateMotionConfig).toHaveBeenCalledWith(
        'cam-1',
        expect.objectContaining({ enabled: true, sensitivity: 'medium' }),
      ),
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('el horario aparece solo en modo «según horario»', async () => {
    const user = userEvent.setup();
    render(<MotionSettingsSlideover camera={CAM} onClose={() => {}} />);
    await screen.findByLabelText('Detectar movimiento');

    expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Cuándo vigilar'), 'schedule');
    expect(screen.getByLabelText('Desde')).toBeInTheDocument();
  });

  it('las casillas de día del horario se anuncian con el nombre completo', async () => {
    const user = userEvent.setup();
    render(<MotionSettingsSlideover camera={CAM} onClose={() => {}} />);
    await screen.findByLabelText('Detectar movimiento');
    await user.selectOptions(screen.getByLabelText('Cuándo vigilar'), 'schedule');

    // Sin nombre propio, «M» (martes) y «M»/«X» (miércoles) y «S» (sábado/domingo) se confunden.
    for (const dia of ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']) {
      expect(screen.getByRole('button', { name: dia })).toHaveAttribute('aria-pressed');
    }
  });

  it('si la lectura falla, dice el fallo, no deja guardar y reintentar recupera', async () => {
    const user = userEvent.setup();
    camerasMock.getMotionConfig.mockReset().mockRejectedValueOnce(new Error('boom'));
    camerasMock.getMotionConfig.mockResolvedValue(CONFIG);
    render(<MotionSettingsSlideover camera={CAM} onClose={() => {}} />);
    expect(
      await screen.findByText('No se pudo cargar la configuración de movimiento'),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Detectar movimiento')).not.toBeInTheDocument();
    const guardar = screen.getByRole('button', { name: 'Guardar' });
    expect(guardar).toBeDisabled();
    await user.click(guardar);
    expect(camerasMock.updateMotionConfig).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByLabelText('Detectar movimiento')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar' })).toBeEnabled();
  });
});
