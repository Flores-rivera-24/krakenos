import type { SurveyScan, SurveyScanDetail } from '@krakenos/types';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const coverageMock = vi.hoisted(() => ({
  createScan: vi.fn(),
  deleteScan: vi.fn(),
  getMeasuredHeatmap: vi.fn(),
  getScan: vi.fn(),
  listScans: vi.fn(),
}));
vi.mock('@/lib/coverage', () => coverageMock);

const apiMock = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: apiMock, ApiRequestError: class extends Error {} }));

import { SurveyPanel } from '@/components/coverage/SurveyPanel';

const SCAN: SurveyScan = {
  id: 'scan-1',
  floorPlanId: 'plan-1',
  name: 'Recorrido planta baja',
  band: '5GHz',
  deviceMac: null,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const SCAN_DETAIL: SurveyScanDetail = { ...SCAN, samples: [] };

function noop(): void {
  /* no-op */
}

describe('SurveyPanel', () => {
  beforeEach(() => {
    coverageMock.createScan.mockReset().mockResolvedValue(SCAN);
    coverageMock.deleteScan.mockReset().mockResolvedValue(undefined);
    coverageMock.getMeasuredHeatmap.mockReset();
    coverageMock.getScan.mockReset().mockResolvedValue(SCAN_DETAIL);
    coverageMock.listScans.mockReset().mockResolvedValue([]);
    apiMock.get.mockReset().mockResolvedValue([]); // /inventory
  });

  it('muestra el estado vacío sin surveys', async () => {
    render(
      <SurveyPanel
        floorPlanId="plan-1"
        defaultBand="5GHz"
        activeScan={null}
        onActiveScanChange={noop}
        measuredHeatmap={null}
        onMeasuredHeatmapChange={noop}
        showMeasured={false}
        onShowMeasuredChange={noop}
        manualRssiDbm={-60}
        onManualRssiChange={noop}
        canEdit
      />,
    );
    expect(await screen.findByText(/Aún no hay recorridos/)).toBeInTheDocument();
  });

  it('un viewer (canEdit=false) no ve el botón de crear', async () => {
    render(
      <SurveyPanel
        floorPlanId="plan-1"
        defaultBand="5GHz"
        activeScan={null}
        onActiveScanChange={noop}
        measuredHeatmap={null}
        onMeasuredHeatmapChange={noop}
        showMeasured={false}
        onShowMeasuredChange={noop}
        manualRssiDbm={-60}
        onManualRssiChange={noop}
        canEdit={false}
      />,
    );
    await screen.findByText(/Aún no hay recorridos/);
    expect(screen.queryByRole('button', { name: /Nuevo/ })).not.toBeInTheDocument();
  });

  it('crea un survey y lo activa (flujo completo del formulario)', async () => {
    const user = userEvent.setup();
    const onActiveScanChange = vi.fn();
    render(
      <SurveyPanel
        floorPlanId="plan-1"
        defaultBand="5GHz"
        activeScan={null}
        onActiveScanChange={onActiveScanChange}
        measuredHeatmap={null}
        onMeasuredHeatmapChange={noop}
        showMeasured={false}
        onShowMeasuredChange={noop}
        manualRssiDbm={-60}
        onManualRssiChange={noop}
        canEdit
      />,
    );
    await screen.findByText(/Aún no hay recorridos/);

    await user.click(screen.getByRole('button', { name: /Nuevo/ }));
    await user.type(screen.getByLabelText('Nombre'), 'Recorrido planta baja');
    await user.click(screen.getByRole('button', { name: 'Crear survey' }));

    await waitFor(() =>
      expect(coverageMock.createScan).toHaveBeenCalledWith('plan-1', {
        name: 'Recorrido planta baja',
        band: '5GHz',
        deviceMac: null,
      }),
    );
    await waitFor(() => expect(coverageMock.getScan).toHaveBeenCalledWith('scan-1'));
    expect(onActiveScanChange).toHaveBeenCalledWith(SCAN_DETAIL);
  });

  it('con un survey activo, alternar a "Ver mapa medido" pide el heatmap medido', async () => {
    const user = userEvent.setup();
    const onMeasuredHeatmapChange = vi.fn();
    const onShowMeasuredChange = vi.fn();
    coverageMock.getMeasuredHeatmap.mockResolvedValue({
      band: '5GHz',
      source: 'measured',
      widthM: 10,
      heightM: 8,
      cols: 1,
      rows: 1,
      cellSizeM: 5,
      values: [-60],
      minDbm: -85,
      maxDbm: -45,
    });

    render(
      <SurveyPanel
        floorPlanId="plan-1"
        defaultBand="5GHz"
        activeScan={SCAN_DETAIL}
        onActiveScanChange={noop}
        measuredHeatmap={null}
        onMeasuredHeatmapChange={onMeasuredHeatmapChange}
        showMeasured={false}
        onShowMeasuredChange={onShowMeasuredChange}
        manualRssiDbm={-60}
        onManualRssiChange={noop}
        canEdit
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Ver mapa medido' }));

    await waitFor(() => expect(coverageMock.getMeasuredHeatmap).toHaveBeenCalledWith('scan-1'));
    expect(onMeasuredHeatmapChange).toHaveBeenCalled();
    expect(onShowMeasuredChange).toHaveBeenCalledWith(true);
  });

  it('borra un survey de la lista', async () => {
    coverageMock.listScans.mockResolvedValue([SCAN]);
    const user = userEvent.setup();
    render(
      <SurveyPanel
        floorPlanId="plan-1"
        defaultBand="5GHz"
        activeScan={null}
        onActiveScanChange={noop}
        measuredHeatmap={null}
        onMeasuredHeatmapChange={noop}
        showMeasured={false}
        onShowMeasuredChange={noop}
        manualRssiDbm={-60}
        onManualRssiChange={noop}
        canEdit
      />,
    );

    await screen.findByText('Recorrido planta baja');
    await user.click(screen.getByRole('button', { name: `Eliminar ${SCAN.name}` }));

    await waitFor(() => expect(coverageMock.deleteScan).toHaveBeenCalledWith('scan-1'));
    await waitFor(() => expect(screen.queryByText('Recorrido planta baja')).not.toBeInTheDocument());
  });

  it('en un survey manual (sin dispositivo) ofrece el campo de dBm y propaga cambios', async () => {
    const user = userEvent.setup();
    const onManualRssiChange = vi.fn();
    render(
      <SurveyPanel
        floorPlanId="plan-1"
        defaultBand="5GHz"
        activeScan={SCAN_DETAIL} /* deviceMac: null → survey manual */
        onActiveScanChange={noop}
        measuredHeatmap={null}
        onMeasuredHeatmapChange={noop}
        showMeasured={false}
        onShowMeasuredChange={noop}
        manualRssiDbm={-60}
        onManualRssiChange={onManualRssiChange}
        canEdit
      />,
    );
    const input = await screen.findByLabelText('Señal a registrar (dBm)');
    expect(input).toHaveValue(-60);
    await user.clear(input);
    await user.type(input, '-45');
    expect(onManualRssiChange).toHaveBeenCalled();
  });
});
