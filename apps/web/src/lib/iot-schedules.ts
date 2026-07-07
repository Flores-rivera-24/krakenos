import type {
  CreateIotScheduleRequest,
  IotSchedule,
  IotScheduleTime,
  UpdateIotScheduleRequest,
} from '@krakenos/types';
import { api } from '@/lib/api';

/** Etiquetas cortas de los días de la semana (0=Dom … 6=Sáb). */
export const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Formatea un momento de disparo en algo legible ("07:00", "Atardecer −15m"). */
export function formatScheduleTime(time: IotScheduleTime): string {
  if (time.kind === 'fixed') {
    const h = Math.floor(time.minute / 60);
    const m = time.minute % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const base = time.kind === 'sunrise' ? 'Amanecer' : 'Atardecer';
  if (time.offsetMin === 0) return base;
  const sign = time.offsetMin > 0 ? '+' : '−';
  return `${base} ${sign}${Math.abs(time.offsetMin)}m`;
}

/** "HH:MM" → minutos del día (0-1439). */
export function timeStringToMinute(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** minutos del día → "HH:MM" para un `<input type="time">`. */
export function minuteToTimeString(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export const listIotSchedules = () => api.get<IotSchedule[]>('/iot-schedules');
export const createIotSchedule = (body: CreateIotScheduleRequest) =>
  api.post<IotSchedule>('/iot-schedules', body);
export const updateIotSchedule = (id: string, body: UpdateIotScheduleRequest) =>
  api.patch<IotSchedule>(`/iot-schedules/${id}`, body);
export const deleteIotSchedule = (id: string) => api.del<void>(`/iot-schedules/${id}`);
