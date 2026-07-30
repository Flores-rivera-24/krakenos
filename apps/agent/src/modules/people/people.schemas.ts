import { errorResponse } from '../common.schemas.js';

/** JSON Schemas de las personas del hogar (US-240). */

const days = {
  type: 'array',
  items: { type: 'integer', minimum: 0, maximum: 6 },
  minItems: 1,
  maxItems: 7,
} as const;

const minute = { type: 'integer', minimum: 0, maximum: 1439 } as const;

const personDevice = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'online', 'blocked', 'reasons', 'pausedUntil'],
  properties: {
    id: { type: 'string' },
    // Sin `mac` ni `ip` a propósito: esta vista ata aparato→persona y la MAC no
    // aporta nada al caso de uso (US-240).
    name: { type: 'string' },
    online: { type: 'boolean' },
    blocked: { type: 'boolean' },
    reasons: { type: 'array', items: { type: 'string', enum: ['manual', 'schedule', 'paused'] } },
    pausedUntil: { type: ['string', 'null'] },
  },
} as const;

const bedtime = {
  type: 'object',
  additionalProperties: false,
  required: ['enabled', 'days', 'startMinute', 'endMinute', 'appliedTo'],
  properties: {
    enabled: { type: 'boolean' },
    days: { type: 'array', items: { type: 'integer' } },
    startMinute: { type: 'integer' },
    endMinute: { type: 'integer' },
    appliedTo: { type: 'integer' },
  },
} as const;

const personSummary = {
  type: 'object',
  additionalProperties: false,
  required: [
    'userId',
    'name',
    'role',
    'devices',
    'onlineCount',
    'blockedCount',
    'pausedUntil',
    'bedtime',
  ],
  properties: {
    userId: { type: ['string', 'null'] },
    name: { type: 'string' },
    role: { type: ['string', 'null'] },
    devices: { type: 'array', items: personDevice },
    onlineCount: { type: 'integer' },
    blockedCount: { type: 'integer' },
    pausedUntil: { type: ['string', 'null'] },
    // Unión de tipos, no `anyOf`: el patrón del proyecto para «X o null»
    // (`integrations.schemas.ts` explica por qué con `coerceTypes` de ajv).
    bedtime: { ...bedtime, type: ['object', 'null'] },
  },
} as const;

/** `GET /api/people` — personas del hogar con sus dispositivos y su acceso. */
export const listPeopleSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['people', 'fullHome', 'unassignedDevices'],
      properties: {
        people: { type: 'array', items: personSummary },
        fullHome: { type: 'boolean' },
        unassignedDevices: { type: 'integer' },
      },
    },
  },
} as const;

const idParam = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1, maxLength: 64 } },
} as const;

const actionResult = {
  type: 'object',
  additionalProperties: false,
  required: ['applied', 'failed'],
  properties: {
    applied: { type: 'integer' },
    failed: { type: 'integer' },
    pausedUntil: { type: 'string' },
  },
} as const;

/** `POST /api/people/:id/pause` — pausa el internet de todos sus dispositivos. */
export const pausePersonSchema = {
  params: idParam,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['minutes'],
    properties: { minutes: { type: 'integer', minimum: 1, maximum: 1440 } },
  },
  response: { 200: actionResult, 404: errorResponse },
} as const;

/** `POST /api/people/:id/resume` — devuelve el internet a todos sus dispositivos. */
export const resumePersonSchema = {
  params: idParam,
  response: { 200: actionResult, 404: errorResponse },
} as const;

/** `PUT /api/people/:id/bedtime` — hora de dormir aplicada a todos sus dispositivos. */
export const setBedtimeSchema = {
  params: idParam,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['days', 'startMinute', 'endMinute'],
    properties: { days, startMinute: minute, endMinute: minute, enabled: { type: 'boolean' } },
  },
  response: { 200: actionResult, 404: errorResponse },
} as const;

/** `DELETE /api/people/:id/bedtime` — la quita. */
export const clearBedtimeSchema = {
  params: idParam,
  response: { 200: actionResult, 404: errorResponse },
} as const;
