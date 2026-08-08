import { AUTO_BACKUP_FREQUENCIES, SYSTEM_SETTING_KEYS, UPDATE_STEPS } from '@krakenos/types';
import { errorResponse } from '../common.schemas.js';

/** `GET /api/system/tls` — estado del certificado (US-241). */
export const systemTlsSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: [
        'enabled',
        'behindProxy',
        'source',
        'notAfter',
        'daysLeft',
        'expiring',
        'expired',
        'disabledFeatures',
      ],
      properties: {
        enabled: { type: 'boolean' },
        behindProxy: { type: 'boolean' },
        source: { type: ['string', 'null'], enum: ['tailscale', 'self-signed', 'unknown', null] },
        notAfter: { type: ['string', 'null'] },
        daysLeft: { type: ['integer', 'null'] },
        expiring: { type: 'boolean' },
        expired: { type: 'boolean' },
        disabledFeatures: {
          type: 'array',
          items: { type: 'string', enum: ['pwa', 'push', 'passkeys'] },
        },
      },
    },
  },
} as const;

export const systemStatsSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        uptimeSeconds: { type: 'number' },
        cpu: {
          type: 'object',
          properties: {
            cores: { type: 'integer' },
            loadPercent: { type: 'number' },
          },
          required: ['cores', 'loadPercent'],
        },
        memory: {
          type: 'object',
          properties: {
            totalBytes: { type: 'number' },
            usedBytes: { type: 'number' },
            usedPercent: { type: 'number' },
          },
          required: ['totalBytes', 'usedBytes', 'usedPercent'],
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
      required: ['uptimeSeconds', 'cpu', 'memory', 'timestamp'],
    },
  },
} as const;

const settingsResponse = {
  type: 'object',
  properties: {
    settings: {
      type: 'object',
      additionalProperties: { type: 'string' },
    },
    info: {
      type: 'object',
      properties: {
        driver: { type: 'string' },
        host: { type: ['string', 'null'] },
        httpsEnabled: { type: 'boolean' },
      },
      required: ['driver', 'host', 'httpsEnabled'],
    },
  },
  required: ['settings', 'info'],
} as const;

export const getSettingsSchema = {
  response: { 200: settingsResponse },
} as const;

/** Igual que `settingsResponse` pero con el flag de aplicación en caliente (US-47). */
const updateSettingResponse = {
  type: 'object',
  properties: {
    ...settingsResponse.properties,
    appliedImmediately: { type: 'boolean' },
  },
  required: [...settingsResponse.required],
} as const;

export const updateSettingSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['key', 'value'],
    properties: {
      key: { type: 'string', enum: [...SYSTEM_SETTING_KEYS] },
      value: { type: 'string', maxLength: 200 },
    },
  },
  response: { 200: updateSettingResponse },
} as const;

/** `GET /api/system/info` — info pública para la pantalla de login (US-49). */
export const systemInfoSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      properties: {
        homeName: { type: 'string' },
        // Opcional: solo presente si PUBLIC_VERSION=true (US-83).
        version: { type: 'string' },
      },
      required: ['homeName'],
    },
  },
} as const;

const updateResultSchema = {
  type: ['object', 'null'],
  properties: {
    ok: { type: 'boolean' },
    rolledBack: { type: 'boolean' },
    fromVersion: { type: 'string' },
    targetVersion: { type: ['string', 'null'] },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          step: { type: 'string', enum: [...UPDATE_STEPS] },
          status: { type: 'string', enum: ['ok', 'failed', 'skipped'] },
          detail: { type: 'string' },
        },
        required: ['step', 'status'],
      },
    },
    finishedAt: { type: 'string' },
  },
  required: ['ok', 'rolledBack', 'fromVersion', 'targetVersion', 'steps', 'finishedAt'],
} as const;

/** `GET /api/system/update/plan` — plan de actualización one-click (US-190). */
export const updatePlanSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean' },
        current: { type: 'string' },
        latest: { type: ['string', 'null'] },
        updateAvailable: { type: 'boolean' },
        mode: { type: 'string', enum: ['systemd', 'docker'] },
        canSelfUpdate: { type: 'boolean' },
        dockerCommand: { type: ['string', 'null'] },
        inProgress: { type: 'boolean' },
        inProgressSince: { type: ['string', 'null'] },
        maintenanceWindow: { type: ['string', 'null'] },
        lastResult: updateResultSchema,
      },
      required: [
        'enabled',
        'current',
        'latest',
        'updateAvailable',
        'mode',
        'canSelfUpdate',
        'dockerCommand',
        'inProgress',
        'inProgressSince',
        'maintenanceWindow',
        'lastResult',
      ],
    },
  },
} as const;

/** `POST /api/system/update/apply` — lanza la actualización one-click (US-190). */
export const updateApplySchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      // Saltarse la ventana de mantenimiento (el admin quiere actualizar ya).
      force: { type: 'boolean' },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      properties: {
        started: { type: 'boolean' },
        mode: { type: 'string', enum: ['systemd', 'docker'] },
        message: { type: 'string' },
        dockerCommand: { type: 'string' },
      },
      required: ['started', 'mode', 'message'],
    },
    409: errorResponse,
  },
} as const;

/**
 * `POST /api/system/update/cancel` — libera el lock de «actualización en curso»
 * (US-232). Sin cuerpo: no cancela *una* actualización concreta, desbloquea la
 * función. Devuelve 200 con `cancelled:false` si no había nada que cancelar.
 */
export const updateCancelSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cancelled: { type: 'boolean' },
        message: { type: 'string' },
      },
      required: ['cancelled', 'message'],
    },
    401: errorResponse,
    403: errorResponse,
  },
} as const;

/** `GET /api/system/telemetry` — telemetría anónima opt-in (US-192, lectura auth). */
export const telemetrySchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean' },
        version: { type: 'string' },
        counts: {
          type: 'object',
          properties: {
            devices: { type: 'number' },
            rooms: { type: 'number' },
            scenes: { type: 'number' },
            automations: { type: 'number' },
            users: { type: 'number' },
          },
        },
      },
      required: ['enabled', 'version'],
    },
  },
} as const;

/**
 * `POST /api/system/support-bundle` — bundle de soporte sanitizado (US-192). Sin
 * schema de `response`: el cuerpo es el JSON del bundle servido como descarga.
 */
export const supportBundleSchema = {} as const;

/** `GET /api/system/metrics` — observabilidad interna (US-191, lectura auth). */
export const metricsSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      properties: {
        uptimeSeconds: { type: 'number' },
        memory: {
          type: 'object',
          properties: {
            rssBytes: { type: 'number' },
            heapUsedBytes: { type: 'number' },
            heapTotalBytes: { type: 'number' },
          },
          required: ['rssBytes', 'heapUsedBytes', 'heapTotalBytes'],
        },
        http: {
          type: 'object',
          properties: {
            total: { type: 'number' },
            errors: { type: 'number' },
            errorRate: { type: 'number' },
            avgLatencyMs: { type: 'number' },
            p95LatencyMs: { type: 'number' },
            inFlight: { type: 'number' },
          },
          required: ['total', 'errors', 'errorRate', 'avgLatencyMs', 'p95LatencyMs', 'inFlight'],
        },
        eventLoop: {
          type: 'object',
          properties: {
            lagMs: { type: 'number' },
            maxLagMs: { type: 'number' },
          },
          required: ['lagMs', 'maxLagMs'],
        },
        websocketClients: { type: 'number' },
        storage: {
          type: 'object',
          properties: {
            dbBytes: { type: ['number', 'null'] },
            diskFreeBytes: { type: ['number', 'null'] },
            diskTotalBytes: { type: ['number', 'null'] },
            diskUsedPercent: { type: ['number', 'null'] },
          },
          required: ['dbBytes', 'diskFreeBytes', 'diskTotalBytes', 'diskUsedPercent'],
        },
        managers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              count: { type: 'number' },
              errors: { type: 'number' },
              avgLatencyMs: { type: 'number' },
              maxLatencyMs: { type: 'number' },
            },
            required: ['name', 'count', 'errors', 'avgLatencyMs', 'maxLatencyMs'],
          },
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
      required: [
        'uptimeSeconds',
        'memory',
        'http',
        'eventLoop',
        'websocketClients',
        'storage',
        'managers',
        'timestamp',
      ],
    },
  },
} as const;

/** `GET /api/system/update-check` — estado de actualizaciones (US-116). */
export const updateCheckSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      properties: {
        enabled: { type: 'boolean' },
        current: { type: 'string' },
        latest: { type: ['string', 'null'] },
        updateAvailable: { type: 'boolean' },
      },
      required: ['enabled', 'current', 'latest', 'updateAvailable'],
    },
  },
} as const;

export const connectivityTestSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        latencyMs: { type: 'number' },
        error: { type: 'string' },
      },
      required: ['ok'],
    },
  },
} as const;

/** `POST /api/system/regen-keys` — revoca todos los refresh tokens (204, sin cuerpo). */
export const regenKeysSchema = {
  response: { 204: { type: 'null' } },
} as const;

/**
 * `POST /api/system/backup` — genera la copia de seguridad cifrada (US-103). Sin
 * schema de `response`: el cuerpo es binario (el archivo) y no debe serializarse.
 */
export const backupSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['passphrase'],
    // Mín 12: el archivo cifra las joyas de la corona; una passphrase corta sería
    // fuerza-bruteable offline si el archivo se filtra.
    properties: { passphrase: { type: 'string', minLength: 12, maxLength: 256 } },
  },
} as const;

/**
 * `POST /api/system/restore` — sube un backup (base64) + passphrase; se **valida y
 * prepara** para aplicar al reiniciar (US-104). No aplica en caliente.
 */
export const restoreSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['passphrase', 'data'],
    properties: {
      passphrase: { type: 'string', minLength: 12, maxLength: 256 },
      // El archivo cifrado, en base64 (base64 de ~64 MB ≈ 88 M de caracteres).
      data: { type: 'string', minLength: 1, maxLength: 90_000_000 },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['staged', 'restartRequired'],
      properties: {
        staged: { type: 'integer' },
        restartRequired: { type: 'boolean' },
      },
    },
    400: errorResponse,
  },
} as const;

/** `GET /api/system/backup/auto` — estado de las copias automáticas (US-233). */
export const autoBackupStatusSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: [
        'frequency',
        'retention',
        'passphraseSet',
        'count',
        'totalBytes',
        'lastBackupAt',
        'lastBackupBytes',
        'lastError',
        'stale',
      ],
      properties: {
        frequency: { type: 'string', enum: [...AUTO_BACKUP_FREQUENCIES] },
        retention: { type: 'integer' },
        passphraseSet: { type: 'boolean' },
        count: { type: 'integer' },
        totalBytes: { type: 'integer' },
        lastBackupAt: { type: ['string', 'null'] },
        lastBackupBytes: { type: ['integer', 'null'] },
        lastError: { type: ['string', 'null'] },
        stale: { type: 'boolean' },
      },
    },
  },
} as const;

/**
 * `POST /api/system/backup/auto/passphrase` — fija o **genera** la contraseña de las
 * copias automáticas (US-233). Sin cuerpo genera una y la devuelve **una sola vez**.
 */
export const autoBackupPassphraseSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      passphrase: { type: 'string', minLength: 12, maxLength: 256 },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['passphraseSet'],
      properties: {
        passphraseSet: { type: 'boolean' },
        /** Solo cuando se acaba de generar: es la única vez que se muestra así. */
        generated: { type: ['string', 'null'] },
      },
    },
  },
} as const;

/** `POST /api/system/backup/auto/passphrase/reveal` — muestra la contraseña guardada. */
export const autoBackupRevealSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['passphrase'],
      properties: { passphrase: { type: ['string', 'null'] } },
    },
  },
} as const;

/**
 * `POST /api/system/restore/upload` — restauración por **streaming** (US-233). El
 * cuerpo es el archivo binario (`application/octet-stream`), así que no hay schema
 * de body; la passphrase viaja en cabecera (nunca en la URL: acabaría en los logs).
 */
export const restoreUploadSchema = {
  // Sin schema de `headers` a propósito: la validación de Fastify corre ANTES del
  // preHandler de auth, así que exigir la cabecera aquí daría 400 a una petición sin
  // token en vez de 401 (y rompería el barrido de autorización). La cabecera se
  // comprueba en el handler, ya autenticado.
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['staged', 'restartRequired'],
      properties: {
        staged: { type: 'integer' },
        restartRequired: { type: 'boolean' },
      },
    },
    400: errorResponse,
    413: errorResponse,
  },
} as const;
