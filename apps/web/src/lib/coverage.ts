import type {
  CoverageHeatmap,
  CreateFloorPlanRequest,
  CreateSurveyScanRequest,
  FloorPlan,
  MeasureResult,
  PlaceableAccessPoint,
  RecordSurveySampleRequest,
  SurveyScan,
  SurveyScanDetail,
  UpdateFloorPlanRequest,
  WifiBand,
} from '@krakenos/types';
import { api } from '@/lib/api';

/**
 * Envoltorio fino sobre `@/lib/api` para la cobertura WiFi (planos, predicción
 * de señal por propagación RF y survey de medición real).
 */

export const listFloorPlans = (): Promise<FloorPlan[]> => api.get<FloorPlan[]>('/coverage/floorplans');

export const getFloorPlan = (id: string): Promise<FloorPlan> =>
  api.get<FloorPlan>(`/coverage/floorplans/${id}`);

export const createFloorPlan = (body: CreateFloorPlanRequest): Promise<FloorPlan> =>
  api.post<FloorPlan>('/coverage/floorplans', body);

export const updateFloorPlan = (id: string, body: UpdateFloorPlanRequest): Promise<FloorPlan> =>
  api.patch<FloorPlan>(`/coverage/floorplans/${id}`, body);

export const deleteFloorPlan = (id: string): Promise<void> =>
  api.del<void>(`/coverage/floorplans/${id}`);

export const getPredictedHeatmap = (id: string, band: WifiBand): Promise<CoverageHeatmap> =>
  api.get<CoverageHeatmap>(`/coverage/floorplans/${id}/heatmap?band=${encodeURIComponent(band)}`);

export const listPlaceableAccessPoints = (): Promise<PlaceableAccessPoint[]> =>
  api.get<PlaceableAccessPoint[]>('/coverage/access-points');

export const listScans = (floorPlanId: string): Promise<SurveyScan[]> =>
  api.get<SurveyScan[]>(`/coverage/floorplans/${floorPlanId}/scans`);

export const createScan = (
  floorPlanId: string,
  body: CreateSurveyScanRequest,
): Promise<SurveyScan> => api.post<SurveyScan>(`/coverage/floorplans/${floorPlanId}/scans`, body);

export const getScan = (scanId: string): Promise<SurveyScanDetail> =>
  api.get<SurveyScanDetail>(`/coverage/scans/${scanId}`);

export const deleteScan = (scanId: string): Promise<void> =>
  api.del<void>(`/coverage/scans/${scanId}`);

export const recordSample = (
  scanId: string,
  body: RecordSurveySampleRequest,
): Promise<MeasureResult> => api.post<MeasureResult>(`/coverage/scans/${scanId}/samples`, body);

export const getMeasuredHeatmap = (scanId: string): Promise<CoverageHeatmap> =>
  api.get<CoverageHeatmap>(`/coverage/scans/${scanId}/heatmap`);
