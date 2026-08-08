import type {
  CreateEnergyAlertRuleRequest,
  EnergyAlertRule,
  EnergyConfig,
  EnergyRange,
  EnergyStats,
  UpdateEnergyAlertRuleRequest,
} from '@krakenos/types';
import { api } from './api';

/** Rangos disponibles del panel de energía (US-182). */
export const ENERGY_RANGES: { value: EnergyRange; label: string }[] = [
  { value: 'day', label: '24h' },
  { value: 'week', label: '7d' },
  { value: 'month', label: '30d' },
];

export function fetchEnergyStats(range: EnergyRange): Promise<EnergyStats> {
  return api.get<EnergyStats>(`/energy/stats?range=${range}`);
}

export function fetchEnergyConfig(): Promise<EnergyConfig> {
  return api.get<EnergyConfig>('/energy/config');
}

export function saveEnergyConfig(input: {
  pricePerKwh?: number | null;
  currency?: string;
}): Promise<EnergyConfig> {
  return api.put<EnergyConfig>('/energy/config', input);
}

// --- Alertas de consumo (US-183) ---

export function fetchEnergyAlerts(): Promise<EnergyAlertRule[]> {
  return api.getList<EnergyAlertRule>('/energy/alerts');
}

export function createEnergyAlert(input: CreateEnergyAlertRuleRequest): Promise<EnergyAlertRule> {
  return api.post<EnergyAlertRule>('/energy/alerts', input);
}

export function updateEnergyAlert(
  id: string,
  patch: UpdateEnergyAlertRuleRequest,
): Promise<EnergyAlertRule> {
  return api.patch<EnergyAlertRule>(`/energy/alerts/${id}`, patch);
}

export function deleteEnergyAlert(id: string): Promise<void> {
  return api.del<void>(`/energy/alerts/${id}`);
}

/**
 * Formatea energía en Wh o kWh según su magnitud (US-182): por debajo de 1 kWh
 * se muestra en Wh (más legible para un enchufe), por encima en kWh.
 */
export function formatEnergy(wh: number): string {
  if (wh >= 1000) return `${(wh / 1000).toFixed(2)} kWh`;
  return `${Math.round(wh)} Wh`;
}

/** Formatea un coste con el símbolo de moneda del hogar; `null` → guion. */
export function formatCost(cost: number | null, currency: string): string {
  if (cost === null) return '—';
  return `${cost.toFixed(2)} ${currency}`;
}

/**
 * Variación porcentual respecto al periodo anterior (US-182). `null` si no hay
 * base de comparación (periodo anterior a 0), para no dividir por cero.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
