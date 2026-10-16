import type {
  CreateEnergyAlertRuleRequest,
  EnergyAlertRule,
  EnergyConfig,
  EnergyRange,
  EnergyStats,
  UpdateEnergyAlertRuleRequest,
} from '@krakenos/types';
import { api } from './api';
import { formatFixed, formatNumber } from './format';

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
  return formatEnergyIn(wh, energyUnitFor(wh));
}

/** Unidad de energía con la que se muestra una magnitud. */
export type EnergyUnit = 'Wh' | 'kWh';

/**
 * Unidad para una magnitud: kWh a partir de 1000 Wh, Wh por debajo. Es la ÚNICA
 * regla de escala: la tarjeta de total y el eje del gráfico la comparten (el eje
 * iba en kWh —«0.032»— mientras la tarjeta decía «32 Wh» y había que adivinar que
 * eran lo mismo).
 */
export function energyUnitFor(wh: number): EnergyUnit {
  return Math.abs(wh) >= 1000 ? 'kWh' : 'Wh';
}

/** Un valor en Wh expresado en la unidad dada, sin redondear. */
export function energyIn(wh: number, unit: EnergyUnit): number {
  return unit === 'kWh' ? wh / 1000 : wh;
}

/** Un valor en Wh escrito en la unidad dada: «2,50 kWh» · «32 Wh». */
export function formatEnergyIn(wh: number, unit: EnergyUnit): string {
  return unit === 'kWh' ? `${formatFixed(wh / 1000, 2)} kWh` : `${formatNumber(Math.round(wh))} Wh`;
}

/** Una marca del eje en la unidad dada, sin la unidad (va en el título): «0,016» · «32». */
export function formatEnergyTick(value: number, unit: EnergyUnit): string {
  return formatNumber(value, { maximumFractionDigits: unit === 'kWh' ? 3 : 1 });
}

/** Formatea un coste con el símbolo de moneda del hogar; `null` → guion. */
export function formatCost(cost: number | null, currency: string): string {
  if (cost === null) return '—';
  return `${formatFixed(cost, 2)} ${currency}`;
}

/**
 * Variación porcentual respecto al periodo anterior (US-182). `null` si no hay
 * base de comparación (periodo anterior a 0), para no dividir por cero.
 */
export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
