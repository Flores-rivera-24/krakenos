import type {
  MatterBridgeState,
  MatterCommissionResult,
  UpdateMatterBridgeRequest,
} from '@krakenos/types';
import { api } from './api';

/** Comisiona un dispositivo Matter nuevo por su QR/código (US-172). */
export function commissionMatter(code: string): Promise<MatterCommissionResult> {
  return api.post<MatterCommissionResult>('/iot/matter/commission', { code });
}

export function fetchMatterBridge(): Promise<MatterBridgeState> {
  return api.get<MatterBridgeState>('/matter-bridge');
}

export function updateMatterBridge(req: UpdateMatterBridgeRequest): Promise<MatterBridgeState> {
  return api.put<MatterBridgeState>('/matter-bridge', req);
}
