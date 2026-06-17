import type { Camera, CameraSnapshot } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { CamerasPage } from '@/pages/CamerasPage';

const CAMERAS: Camera[] = [
  { id: 'cam-entrada', name: 'Entrada', room: 'Exterior', model: 'X', online: true },
  { id: 'cam-garaje', name: 'Garaje', room: 'Sótano', model: 'X', online: false },
];

const SNAP: CameraSnapshot = {
  cameraId: 'cam-entrada',
  image: 'data:image/svg+xml;base64,AAAA',
  capturedAt: '2026-06-17T00:00:00.000Z',
};

describe('CamerasPage', () => {
  beforeEach(() => {
    apiMock.get.mockReset().mockImplementation((path: string) =>
      path === '/cameras' ? Promise.resolve(CAMERAS) : Promise.resolve(SNAP),
    );
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
});
