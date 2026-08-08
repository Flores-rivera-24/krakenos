import type { AlertRule, UpdateAlertRuleRequest } from '@krakenos/types';
import { api } from '@/lib/api';

/** Cliente de las reglas de alerta (US-112). */

export const listAlertRules = (): Promise<AlertRule[]> => api.getList<AlertRule>('/alerts/rules');

export const updateAlertRule = (event: string, body: UpdateAlertRuleRequest): Promise<AlertRule> =>
  api.patch<AlertRule>(`/alerts/rules/${encodeURIComponent(event)}`, body);
