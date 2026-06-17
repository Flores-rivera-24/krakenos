import type { IsoDateTime } from './common.js';

/** Estadísticas del servidor local donde corre el agente. */
export interface SystemStats {
  /** Uptime del sistema operativo en segundos. */
  uptimeSeconds: number;
  cpu: {
    /** Número de núcleos lógicos. */
    cores: number;
    /** Carga media (1 min) normalizada a porcentaje sobre los núcleos. */
    loadPercent: number;
  };
  memory: {
    totalBytes: number;
    usedBytes: number;
    /** Memoria usada como porcentaje del total. */
    usedPercent: number;
  };
  timestamp: IsoDateTime;
}
