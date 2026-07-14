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
  // Ubicación del hogar para el cálculo solar de horarios (US-168). Vacío = sin
  // amanecer/atardecer (los horarios solares no disparan hasta configurarla).
  'homeLatitude',
  'homeLongitude',
  // Ventana de gracia de la presencia en minutos (US-169): los móviles duermen
  // el WiFi, así que "salió de casa" solo se marca tras este tiempo sin señal.
  'presenceGraceMin',
  // Resumen del hogar (US-180): off | daily | weekly (se envía a las 08:00).
  'digestFrequency',
  // Ventana de mantenimiento para la actualización one-click (US-190): franja
  // "HH:MM-HH:MM" (hora local) en la que se permite aplicar una actualización.
  // Vacío = sin restricción (se puede aplicar en cualquier momento).
  'updateMaintenanceWindow',
] as const;

export type SystemSettingKey = (typeof SYSTEM_SETTING_KEYS)[number];

/** Info de solo lectura del sistema mostrada en Ajustes. */
export interface SystemInfo {
  driver: string;
  host: string | null;
  httpsEnabled: boolean;
}

/**
 * Info pública del sistema para la pantalla de login (US-49).
 * Endpoint `GET /api/system/info` — sin autenticación.
 */
export interface SystemPublicInfo {
  /** Nombre del hogar (`Setting` `homeName`, default 'Mi hogar'). */
  homeName: string;
  /**
   * Versión del agente (`package.json`). Solo se expone si `PUBLIC_VERSION=true`
   * (off por defecto, US-83): omitirla evita el fingerprinting pre-auth.
   */
  version?: string;
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

/**
 * Estado de la comprobación de actualizaciones (US-116). `enabled` es `false`
 * cuando no hay repo de GitHub configurado (sin llamadas externas).
 */
export interface UpdateStatus {
  enabled: boolean;
  current: string;
  latest: string | null;
  updateAvailable: boolean;
}

/**
 * Modo de despliegue (US-190). Determina si la actualización puede aplicarse
 * sola (`systemd`/bare-metal, el proceso puede reemplazarse desde fuera) o si el
 * contenedor no puede auto-reemplazarse (`docker`, se muestra el comando manual).
 */
export const DEPLOY_MODES = ['systemd', 'docker'] as const;
export type DeployMode = (typeof DEPLOY_MODES)[number];

/** Pasos de la orquestación de actualización (US-190), en orden de ejecución. */
export const UPDATE_STEPS = [
  'backup',
  'fetch',
  'apply',
  'migrate',
  'restart',
  'healthcheck',
  'rollback',
] as const;
export type UpdateStep = (typeof UPDATE_STEPS)[number];

export type UpdateStepStatus = 'ok' | 'failed' | 'skipped';

export interface UpdateStepResult {
  step: UpdateStep;
  status: UpdateStepStatus;
  /** Mensaje breve (motivo del fallo, versión aplicada…). Sin secretos. */
  detail?: string;
}

/**
 * Resultado de una orquestación de actualización (US-190). Lo escribe el proceso
 * actualizador en `var/update-result.json` y lo lee el servicio para mostrarlo.
 */
export interface UpdateResult {
  ok: boolean;
  /** `true` si un fallo tras el backup obligó a revertir a la versión anterior. */
  rolledBack: boolean;
  fromVersion: string;
  targetVersion: string | null;
  steps: UpdateStepResult[];
  finishedAt: IsoDateTime;
}

/**
 * Plan de actualización (US-190): estado de comprobación (US-116) + cómo se
 * aplicaría según el modo de despliegue + resultado de la última actualización.
 */
export interface UpdatePlan {
  /** ¿Hay repo configurado para comprobar releases? (US-116). */
  enabled: boolean;
  current: string;
  latest: string | null;
  updateAvailable: boolean;
  mode: DeployMode;
  /** `true` solo en `systemd`: el contenedor Docker no puede auto-reemplazarse. */
  canSelfUpdate: boolean;
  /** Comando manual a mostrar cuando `mode === 'docker'`. */
  dockerCommand: string | null;
  /** ¿Hay una actualización en curso ahora mismo? */
  inProgress: boolean;
  /** Franja de mantenimiento configurada ("HH:MM-HH:MM") o `null` si sin límite. */
  maintenanceWindow: string | null;
  /** Resultado de la última actualización aplicada, o `null` si nunca se aplicó. */
  lastResult: UpdateResult | null;
}

/** Latencia/errores de una operación con nombre (p. ej. un manager) (US-191). */
export interface ManagerMetric {
  name: string;
  count: number;
  errors: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
}

/**
 * Instantánea de las métricas internas del agente (US-191). Solo lectura
 * autenticada; efímera (se reinicia con el proceso). `/health` sigue mínimo.
 */
export interface MetricsSnapshot {
  uptimeSeconds: number;
  memory: {
    rssBytes: number;
    heapUsedBytes: number;
    heapTotalBytes: number;
  };
  http: {
    total: number;
    errors: number;
    errorRate: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    inFlight: number;
  };
  eventLoop: {
    lagMs: number;
    maxLagMs: number;
  };
  websocketClients: number;
  managers: ManagerMetric[];
  timestamp: IsoDateTime;
}

/** Respuesta de `POST /api/system/update/apply` (US-190). */
export interface ApplyUpdateResponse {
  /** `true` si se lanzó el proceso de actualización (solo `systemd`). */
  started: boolean;
  mode: DeployMode;
  /** Motivo cuando `started` es `false` (docker, fuera de ventana, ya en curso…). */
  message: string;
  /** Comando manual cuando el modo es `docker`. */
  dockerCommand?: string;
}
