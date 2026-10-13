import type {
  MatterBridgeState,
  MatterCommissionResult,
  UpdateMatterBridgeRequest,
} from '@krakenos/types';
import { api } from './api';
import { invalidarIot, trasEscribir } from './resources';

/** Comisiona un dispositivo Matter nuevo por su QR/código (US-172). */
export function commissionMatter(code: string): Promise<MatterCommissionResult> {
  return trasEscribir(
    api.post<MatterCommissionResult>('/iot/matter/commission', { code }),
    invalidarIot,
  );
}

export function fetchMatterBridge(): Promise<MatterBridgeState> {
  return api.get<MatterBridgeState>('/matter-bridge');
}

export function updateMatterBridge(req: UpdateMatterBridgeRequest): Promise<MatterBridgeState> {
  return api.put<MatterBridgeState>('/matter-bridge', req);
}
