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
      properties: {
        homeName: { type: 'string' },
        version: { type: 'string' },
      },
      required: ['homeName', 'version'],
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
