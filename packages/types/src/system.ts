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

/** Claves de ajuste editables desde la UI (allowlist). */
export const SYSTEM_SETTING_KEYS = [
  'homeName',
  'timezone',
  'scanIntervalSec',
  'trafficRetentionDays',
  'auditRetentionDays',
  // Seguridad (US-41)
  'accessTokenTtl',
  'loginRateLimit',
  'theme',
] as const;

export type SystemSettingKey = (typeof SYSTEM_SETTING_KEYS)[number];

/** Info de solo lectura del sistema mostrada en Ajustes. */
export interface SystemInfo {
  driver: string;
  host: string | null;
  httpsEnabled: boolean;
}

/** Respuesta de `GET /api/system/settings`: ajustes editables + info. */
export interface SystemSettingsResponse {
  settings: Record<SystemSettingKey, string>;
  info: SystemInfo;
  /**
   * Presente solo en la respuesta de `PATCH`: `true` cuando el ajuste cambiado
   * tiene efecto sin reiniciar el agente (intervalo de escaneo, rate-limit; US-47).
   */
  appliedImmediately?: boolean;
}

/** Cuerpo de `PATCH /api/system/settings`. */
export interface UpdateSettingRequest {
  key: SystemSettingKey;
  value: string;
}

/** Resultado de `POST /api/system/connectivity-test`. */
export interface ConnectivityTestResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}
