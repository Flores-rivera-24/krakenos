import { SYSTEM_SETTING_KEYS } from '@krakenos/types';

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
  },
} as const;
