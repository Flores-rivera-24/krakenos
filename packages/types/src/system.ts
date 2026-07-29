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
  // Histéresis de salida (US-220): nº de barridos consecutivos offline que se
  // exigen —además de la gracia— para confirmar "salió". Amortigua el parpadeo.
  'presenceLeaveSweeps',
  // Supresión nocturna de salidas (US-220): franja "HH:MM-HH:MM" (hora local) en
  // la que una desaparición WiFi NO dispara "salió" (el móvil duerme el WiFi de
  // madrugada). Vacío = sin supresión.
  'presenceNightSuppress',
  // Resumen del hogar (US-180): off | daily | weekly (se envía a las 08:00).
  'digestFrequency',
  // Copias de seguridad automáticas (US-233): off | daily | weekly (a las 03:00) y
  // cuántas conservar en `data/backups/`. OFF por defecto: la copia lleva secretos y
  // su contraseña, así que activarla es una decisión del dueño.
  'autoBackupFrequency',
  'autoBackupRetention',
  // Ventana de mantenimiento para la actualización one-click (US-190): franja
  // "HH:MM-HH:MM" (hora local) en la que se permite aplicar una actualización.
  // Vacío = sin restricción (se puede aplicar en cualquier momento).
  'updateMaintenanceWindow',
  // Telemetría anónima (US-192): 'on' | 'off'. OFF por defecto (SPECS §9.2). Sin
  // opt-in explícito no se agrega ni se expone ningún dato de uso.
  'telemetryEnabled',
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
  /**
   * ¿Hay una actualización en curso ahora mismo? Un lock huérfano (actualizador
   * muerto) o caducado NO cuenta como en curso (US-232).
   */
  inProgress: boolean;
  /** Cuándo arrancó la actualización en curso (ISO), o `null` si no hay ninguna. */
  inProgressSince: string | null;
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
  /**
   * Disco y tamaño de la base (US-233). El fallo más probable de un aparato sobre
   * tarjeta SD es quedarse sin espacio, y hasta ahora nada lo publicaba.
   */
  storage: StorageInfo;
  timestamp: IsoDateTime;
}

/**
 * Telemetría anónima (US-192). OFF por defecto (SPECS §9.2). Cuando está activa,
 * son **solo recuentos agregados** (sin nombres, MAC, IP ni ubicación): lo que
 * como mucho se compartiría. Local-first: no se envía a ningún sitio, el usuario
 * la ve antes de decidir compartirla.
 */
export interface TelemetrySnapshot {
  enabled: boolean;
  version: string;
  /** Presente solo si `enabled`: recuentos anónimos por tipo de entidad. */
  counts?: {
    devices: number;
    rooms: number;
    scenes: number;
    automations: number;
    iotSchedules: number;
    users: number;
  };
}

/**
 * Bundle de soporte (US-192): instantánea **sanitizada** del estado del sistema
 * para diagnosticar sin exponer secretos ni PII. Los secretos de integración se
 * redactan (solo se dice qué claves hay puestas), la ubicación/nombre del hogar se
 * omiten, y la auditoría reciente va sin IP ni actor.
 */
export interface SupportBundle {
  generatedAt: IsoDateTime;
  version: string;
  deployMode: DeployMode;
  nodeVersion: string;
  platform: string;
  uptimeSeconds: number;
  driverKind: string;
  /** Ajustes editables SIN los de PII (nombre/ubicación del hogar omitidos). */
  settings: Record<string, string>;
  /** Integraciones por dominio con secretos redactados (solo qué claves hay). */
  integrations: {
    domain: string;
    kind: string;
    enabled: boolean;
    config: Record<string, string>;
    secretsSet: string[];
  }[];
  metrics: MetricsSnapshot;
  telemetry: TelemetrySnapshot;
  /** Auditoría reciente: solo acción + fecha (sin IP ni actor). */
  recentAudit: { action: string; at: IsoDateTime }[];
  /** Dónde encontrar los logs reales (no van en el bundle: viven en journald/docker). */
  logsHint: string;
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

/**
 * Almacenamiento (US-233): tamaño de la base y espacio del disco donde vive. Los
 * campos son `null` cuando el sistema no permite medirlos — un gauge ausente es
 * información, no un error. `dbBytes` incluye el `-wal` (US-228).
 */
export interface StorageInfo {
  dbBytes: number | null;
  diskFreeBytes: number | null;
  diskTotalBytes: number | null;
  diskUsedPercent: number | null;
}

/** Frecuencias de la copia de seguridad automática (US-233). */
export const AUTO_BACKUP_FREQUENCIES = ['off', 'daily', 'weekly'] as const;
export type AutoBackupFrequency = (typeof AUTO_BACKUP_FREQUENCIES)[number];

/**
 * Estado de las copias automáticas (US-233). No expone rutas de disco (igual que las
 * grabaciones de cámara): solo lo que la UI necesita para decir la verdad.
 */
export interface AutoBackupStatus {
  frequency: AutoBackupFrequency;
  /** Cuántas copias se conservan en disco. */
  retention: number;
  /** ¿Hay contraseña configurada? (sin ella no se puede hacer ninguna copia). */
  passphraseSet: boolean;
  /** Copias presentes ahora mismo. */
  count: number;
  totalBytes: number;
  lastBackupAt: IsoDateTime | null;
  lastBackupBytes: number | null;
  /** Mensaje del último fallo, o `null` si la última copia fue bien. */
  lastError: string | null;
  /** `true` si están activadas y la copia más reciente es demasiado vieja (o no hay). */
  stale: boolean;
}

/**
 * Resultado de liberar el lock de actualización (US-232). El caso que la
 * caducidad automática no cubre es un actualizador **vivo pero atascado**: esto
 * devuelve la capacidad de reintentar sin entrar por SSH a borrar el fichero.
 */
export interface CancelUpdateResponse {
  /** `true` si había un lock y se liberó; `false` si no había nada que cancelar. */
  cancelled: boolean;
  message: string;
}
