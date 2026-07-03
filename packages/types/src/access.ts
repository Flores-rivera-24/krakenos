import type { Id, IsoDateTime } from './common.js';

/**
 * Horarios de acceso / control parental (US-108). Cada horario bloquea el acceso a
 * internet de UN dispositivo (por MAC) durante ventanas horarias recurrentes —
 * p. ej. "sin internet de 21:00 a 07:00 de domingo a jueves". Si `endMinute ≤
 * startMinute` la ventana **cruza la medianoche**.
 */
export interface AccessSchedule {
  id: Id;
  name: string;
  /** MAC del dispositivo objetivo. */
  mac: string;
  enabled: boolean;
  /** Días en que EMPIEZA la ventana: 0=domingo … 6=sábado. */
  days: number[];
  /** Minutos desde medianoche (0–1439) del inicio de la ventana. */
  startMinute: number;
  /** Minutos desde medianoche (0–1439) del fin. Si ≤ start, cruza medianoche. */
  endMinute: number;
  createdAt: IsoDateTime;
}

export interface CreateAccessScheduleRequest {
  name: string;
  mac: string;
  days: number[];
  startMinute: number;
  endMinute: number;
  enabled?: boolean;
}

export interface UpdateAccessScheduleRequest {
  name?: string;
  enabled?: boolean;
  days?: number[];
  startMinute?: number;
  endMinute?: number;
}
