import type {
  AccessSchedule,
  CreateAccessScheduleRequest,
  UpdateAccessScheduleRequest,
} from '@krakenos/types';
import { api } from '@/lib/api';

/** Cliente de los horarios de acceso / control parental (US-108). */

export const listSchedules = (mac: string): Promise<AccessSchedule[]> =>
  api.getList<AccessSchedule>(`/access/schedules?mac=${encodeURIComponent(mac)}`);

export const createSchedule = (body: CreateAccessScheduleRequest): Promise<AccessSchedule> =>
  api.post<AccessSchedule>('/access/schedules', body);

export const updateSchedule = (
  id: string,
  body: UpdateAccessScheduleRequest,
): Promise<AccessSchedule> => api.patch<AccessSchedule>(`/access/schedules/${id}`, body);

export const deleteSchedule = (id: string): Promise<void> =>
  api.del<void>(`/access/schedules/${id}`);

/** Pausa el internet de un dispositivo N minutos (US-111). */
export const pauseInternet = (mac: string, minutes: number): Promise<{ pausedUntil: string }> =>
  api.post<{ pausedUntil: string }>('/access/pause', { mac, minutes });

/** Reanuda el internet de un dispositivo (US-111). */
export const resumeInternet = (mac: string): Promise<void> =>
  api.post<void>('/access/resume', { mac });

/** Minutos desde medianoche → "HH:MM". */
export const minutesToHHMM = (m: number): string =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** "HH:MM" → minutos desde medianoche. */
export const hhmmToMinutes = (s: string): number => {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/**
 * Etiquetas de un solo carácter por día. US-270: eran una SEGUNDA constante en
 * español, distinta de la de `schedule-format.ts`, así que los días salían en
 * español con la app en inglés y además con dos formatos según la pantalla.
 * Ahora hay una sola fuente y se traduce; se reexporta para no romper importes.
 */
export { diasIniciales } from '@/lib/schedule-format';
