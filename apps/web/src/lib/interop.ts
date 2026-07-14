import type {
  MqttPublishConfig,
  MqttPublishStatus,
  UpdateMqttPublishRequest,
} from '@krakenos/types';
import { api } from '@/lib/api';

export interface MqttState {
  config: MqttPublishConfig;
  status: MqttPublishStatus;
}

/** Cliente de la publicación MQTT saliente (US-174). Admin. */
export const getMqttState = () => api.get<MqttState>('/interop/mqtt');
export const updateMqtt = (body: UpdateMqttPublishRequest) =>
  api.put<MqttState>('/interop/mqtt', body);
