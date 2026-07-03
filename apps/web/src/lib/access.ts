import type {
  AccessSchedule,
  CreateAccessScheduleRequest,
  UpdateAccessScheduleRequest,
} from '@krakenos/types';
import { api } from '@/lib/api';

/** Cliente de los horarios de acceso / control parental (US-108). */

export const listSchedules = (mac: string): Promise<AccessSchedule[]> =>
  api.get<AccessSchedule[]>(`/access/schedules?mac=${encodeURIComponent(mac)}`);

export const createSchedule = (body: CreateAccessScheduleRequest): Promise<AccessSchedule> =>
  api.post<AccessSchedule>('/access/schedules', body);

export const updateSchedule = (
  id: string,
  body: UpdateAccessScheduleRequest,
): Promise<AccessSchedule> => api.patch<AccessSchedule>(`/access/schedules/${id}`, body);

export const deleteSchedule = (id: string): Promise<void> =>
  api.del<void>(`/access/schedules/${id}`);

/** Minutos desde medianoche → "HH:MM". */
export const minutesToHHMM = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** "HH:MM" → minutos desde medianoche. */
export const hhmmToMinutes = (s: string): number => {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Etiquetas de un solo carácter por día (0=domingo). */
export const DAY_LABELS = ['D', 'L', 'M', 'X', 'J', 'V', 'S'] as const;
