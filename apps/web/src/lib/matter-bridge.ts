import type { MatterBridgeState, UpdateMatterBridgeRequest } from '@krakenos/types';
import { api } from './api';

export function fetchMatterBridge(): Promise<MatterBridgeState> {
  return api.get<MatterBridgeState>('/matter-bridge');
}

export function updateMatterBridge(req: UpdateMatterBridgeRequest): Promise<MatterBridgeState> {
  return api.put<MatterBridgeState>('/matter-bridge', req);
}
