import type { WellbeingRange, WellbeingUsage } from '@krakenos/types';
import { api } from './api';

export const WELLBEING_RANGES: { value: WellbeingRange; label: string }[] = [
  { value: 'day', label: '24h' },
  { value: 'week', label: '7d' },
];

export function fetchWellbeingUsage(range: WellbeingRange): Promise<WellbeingUsage> {
  return api.get<WellbeingUsage>(`/wellbeing/usage?range=${range}`);
}
