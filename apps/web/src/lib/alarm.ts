import type {
  AlarmConfig,
  AlarmMode,
  AlarmState,
  UpdateAlarmConfigRequest,
} from '@krakenos/types';
import { api } from '@/lib/api';

/** Envoltorio fino sobre `@/lib/api` para la alarma del hogar (US-188). */
export const getAlarmState = (): Promise<AlarmState> => api.get<AlarmState>('/alarm');

export const armAlarm = (mode: AlarmMode): Promise<AlarmState> =>
  api.post<AlarmState>('/alarm/arm', { mode });

export const disarmAlarm = (pin?: string): Promise<AlarmState> =>
  api.post<AlarmState>('/alarm/disarm', pin ? { pin } : {});

export const getAlarmConfig = (): Promise<AlarmConfig> => api.get<AlarmConfig>('/alarm/config');

export const updateAlarmConfig = (body: UpdateAlarmConfigRequest): Promise<AlarmConfig> =>
  api.put<AlarmConfig>('/alarm/config', body);
