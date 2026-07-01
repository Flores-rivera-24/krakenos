import type { CoverageHeatmap, FloorPlan, PlaceableAccessPoint, SurveyScan } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const coverageMock = vi.hoisted(() => ({
  listFloorPlans: vi.fn(),
  getFloorPlan: vi.fn(),
  createFloorPlan: vi.fn(),
  updateFloorPlan: vi.fn(),
  deleteFloorPlan: vi.fn(),
  getPredictedHeatmap: vi.fn(),
  listPlaceableAccessPoints: vi.fn(),
  listScans: vi.fn(),
  createScan: vi.fn(),
  getScan: vi.fn(),
  deleteScan: vi.fn(),
  recordSample: vi.fn(),
  getMeasuredHeatmap: vi.fn(),
}));
vi.mock('@/lib/coverage', () => coverageMock);

const apiMock = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), del: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { CoveragePage } from '@/pages/CoveragePage';
import { useAuthStore } from '@/store/auth.store';

function setRole(role: 'admin' | 'viewer') {
  useAuthStore.setState({
    user: { id: 'u', email: 'a@b.c', displayName: 'A', role, createdAt: '', updatedAt: '' },
    tokens: { accessToken: 't', refreshToken: 'r', expiresIn: 900 },
  });
}

const PLAN: FloorPlan = {
  id: 'plan-1',
  name: 'Planta baja',
  widthM: 10,
  heightM: 8,
  backgroundImage: null,
  walls: [],
  accessPoints: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const HEATMAP: CoverageHeatmap = {
  band: '5GHz',
  source: 'predicted',
  widthM: 10,
  heightM: 8,
  cols: 2,
  rows: 2,
  cellSizeM: 5,
  values: [-50, -60, -70, null],
  minDbm: -85,
  maxDbm: -45,
};

const SCAN: SurveyScan = {
  id: 'scan-1',
  floorPlanId: 'plan-1',
  name: 'Recorrido planta baja',
  band: '5GHz',
  deviceMac: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const AP: PlaceableAccessPoint = {
  id: 'ap-1',
  name: 'AP Salón',
  model: 'U6-Lite',
  ip: '192.168.1.2',
  online: true,
  bands: ['5GHz'],
};

describe('CoveragePage', () => {
  beforeEach(() => {
    coverageMock.listFloorPlans.mockReset().mockResolvedValue([PLAN]);
    coverageMock.getFloorPlan.mockReset().mockResolvedValue(PLAN);
    coverageMock.createFloorPlan.mockReset().mockResolvedValue(PLAN);
    coverageMock.updateFloorPlan.mockReset().mockResolvedValue(PLAN);
    coverageMock.deleteFloorPlan.mockReset().mockResolvedValue(undefined);
    coverageMock.getPredictedHeatmap.mockReset().mockResolvedValue(HEATMAP);
    coverageMock.listPlaceableAccessPoints.mockReset().mockResolvedValue([AP]);
    coverageMock.listScans.mockReset().mockResolvedValue([SCAN]);
    coverageMock.createScan.mockReset().mockResolvedValue(SCAN);
    coverageMock.getScan.mockReset().mockResolvedValue({ ...SCAN, samples: [] });
    coverageMock.deleteScan.mockReset().mockResolvedValue(undefined);
    coverageMock.recordSample.mockReset().mockResolvedValue({ found: true, rssiDbm: -55, sample: null });
    coverageMock.getMeasuredHeatmap.mockReset().mockResolvedValue({ ...HEATMAP, source: 'measured' });
    apiMock.get.mockReset().mockResolvedValue([]); // /inventory (SurveyPanel)
  });

  it('carga los planos y muestra el seleccionado', async () => {
    setRole('admin');
    render(<CoveragePage />);

    await waitFor(() => expect(coverageMock.listFloorPlans).toHaveBeenCalled());
    expect(await screen.findByRole('option', { name: 'Planta baja' })).toBeInTheDocument();
  });

  it('muestra el estado vacío sin planos', async () => {
    setRole('admin');
    coverageMock.listFloorPlans.mockResolvedValue([]);
    render(<CoveragePage />);

    expect(await screen.findByText(/Aún no has creado ningún plano/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Crear plano' })).toBeInTheDocument();
  });

  it('un admin ve las acciones de escritura y un viewer no', async () => {
    setRole('admin');
    render(<CoveragePage />);
    await screen.findByRole('option', { name: 'Planta baja' });
    expect(screen.getByRole('button', { name: /Nuevo plano/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Editar plano/ })).toBeInTheDocument();

    setRole('viewer');
    render(<CoveragePage />);
    await screen.findAllByRole('option', { name: 'Planta baja' });
    expect(screen.queryByRole('button', { name: /Nuevo plano/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Editar plano/ })).not.toBeInTheDocument();
  });

  it('cambiar de vista a Predicción pide el heatmap predicho', async () => {
    setRole('admin');
    const user = userEvent.setup();
    render(<CoveragePage />);
    await screen.findByRole('option', { name: 'Planta baja' });

    await user.click(screen.getByRole('button', { name: 'Predicción' }));

    await waitFor(() =>
      expect(coverageMock.getPredictedHeatmap).toHaveBeenCalledWith('plan-1', '5GHz'),
    );
  });

  it('cambiar de banda en Predicción vuelve a pedir el heatmap con la nueva banda', async () => {
    setRole('admin');
    const user = userEvent.setup();
    render(<CoveragePage />);
    await screen.findByRole('option', { name: 'Planta baja' });

    await user.click(screen.getByRole('button', { name: 'Predicción' }));
    await waitFor(() => expect(coverageMock.getPredictedHeatmap).toHaveBeenCalledWith('plan-1', '5GHz'));

    await user.click(screen.getByRole('button', { name: '2.4GHz' }));

    await waitFor(() =>
      expect(coverageMock.getPredictedHeatmap).toHaveBeenCalledWith('plan-1', '2.4GHz'),
    );
  });

  it('cambiar a la vista Survey muestra el panel de recorridos', async () => {
    setRole('admin');
    const user = userEvent.setup();
    render(<CoveragePage />);
    await screen.findByRole('option', { name: 'Planta baja' });

    await user.click(screen.getByRole('button', { name: 'Survey' }));

    expect(await screen.findByText('Recorridos de medición')).toBeInTheDocument();
    await waitFor(() => expect(coverageMock.listScans).toHaveBeenCalledWith('plan-1'));
    expect(screen.getByText('Recorrido planta baja')).toBeInTheDocument();
  });

  it('muestra un banner de error si falla la carga de planos', async () => {
    setRole('admin');
    coverageMock.listFloorPlans.mockRejectedValue(new Error('boom'));
    render(<CoveragePage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});
