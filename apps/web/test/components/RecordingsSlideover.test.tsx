import type { Camera, Recording } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const camerasMock = vi.hoisted(() => ({
  listRecordings: vi.fn(),
  deleteRecording: vi.fn(),
  downloadRecording: vi.fn(),
}));
vi.mock('@/lib/cameras', () => camerasMock);

import { RecordingsSlideover } from '@/components/cameras/RecordingsSlideover';
import { useToastStore } from '@/store/toast.store';

const CAM: Camera = { id: 'cam-1', name: 'Entrada', room: null, model: null, online: true };
const CLIPS: Recording[] = [
  {
    id: 'r1',
    cameraId: 'cam-1',
    cameraName: 'Entrada',
    startedAt: '2026-07-10T10:00:00.000Z',
    durationSec: 10,
    sizeBytes: 2 * 1024 * 1024,
    snapshot: 'data:image/jpeg;base64,x',
  },
];

describe('RecordingsSlideover (US-187)', () => {
  beforeEach(() => {
    camerasMock.listRecordings.mockReset().mockResolvedValue(CLIPS);
    camerasMock.deleteRecording.mockReset().mockResolvedValue(undefined);
    camerasMock.downloadRecording.mockReset().mockResolvedValue(undefined);
    useToastStore.setState({ toasts: [] });
  });

  it('lista los clips de la cámara con su tamaño', async () => {
    render(<RecordingsSlideover camera={CAM} isAdmin={false} onClose={() => {}} />);
    await waitFor(() => expect(camerasMock.listRecordings).toHaveBeenCalledWith('cam-1'));
    expect(await screen.findByText(/2(\.0)? MB/)).toBeInTheDocument();
  });

  it('descarga un clip al pulsar el botón', async () => {
    const user = userEvent.setup();
    render(<RecordingsSlideover camera={CAM} isAdmin={false} onClose={() => {}} />);
    await screen.findByText(/MB/);
    await user.click(screen.getByRole('button', { name: 'Descargar clip' }));
    await waitFor(() => expect(camerasMock.downloadRecording).toHaveBeenCalledWith('r1'));
  });

  it('el viewer no ve el botón de borrar; el admin sí', async () => {
    const { rerender } = render(
      <RecordingsSlideover camera={CAM} isAdmin={false} onClose={() => {}} />,
    );
    await screen.findByText(/MB/);
    expect(screen.queryByRole('button', { name: 'Eliminar clip' })).not.toBeInTheDocument();

    rerender(<RecordingsSlideover camera={CAM} isAdmin={true} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Eliminar clip' })).toBeInTheDocument(),
    );
  });

  it('estado vacío cuando no hay clips', async () => {
    camerasMock.listRecordings.mockResolvedValue([]);
    render(<RecordingsSlideover camera={CAM} isAdmin={false} onClose={() => {}} />);
    expect(await screen.findByText(/Aún no hay grabaciones/)).toBeInTheDocument();
  });
});
