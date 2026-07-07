/** JSON Schemas de horarios para IoT/escenas (US-168). */

const days = {
  type: 'array',
  items: { type: 'integer', minimum: 0, maximum: 6 },
  minItems: 1,
  maxItems: 7,
} as const;

// Momento: hora fija (minuto 0-1439) o solar (amanecer/atardecer + desfase).
const time = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'minute'],
      properties: {
        kind: { const: 'fixed' },
        minute: { type: 'integer', minimum: 0, maximum: 1439 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'offsetMin'],
      properties: {
        kind: { enum: ['sunrise', 'sunset'] },
        offsetMin: { type: 'integer', minimum: -720, maximum: 720 },
      },
    },
  ],
} as const;

// Objetivo: un dispositivo IoT (con estado deseado) o una escena.
const target = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'deviceId'],
      properties: {
        type: { const: 'device' },
        deviceId: { type: 'string', minLength: 1, maxLength: 128 },
        on: { type: 'boolean' },
        brightness: { type: 'integer', minimum: 0, maximum: 100 },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['type', 'sceneId'],
      properties: {
        type: { const: 'scene' },
        sceneId: { type: 'string', minLength: 1, maxLength: 128 },
      },
    },
  ],
} as const;

const scheduleResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'enabled', 'days', 'time', 'target', 'createdAt'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    enabled: { type: 'boolean' },
    days: { type: 'array', items: { type: 'integer' } },
    time: { type: 'object', additionalProperties: true },
    target: { type: 'object', additionalProperties: true },
    createdAt: { type: 'string' },
  },
} as const;

const idParam = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
} as const;

export const listIotSchedulesSchema = {
  response: { 200: { type: 'array', items: scheduleResponse } },
} as const;

export const createIotScheduleSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'days', 'time', 'target'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      enabled: { type: 'boolean' },
      days,
      time,
      target,
    },
  },
  response: { 201: scheduleResponse },
} as const;

export const updateIotScheduleSchema = {
  params: idParam,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      enabled: { type: 'boolean' },
      days,
      time,
      target,
    },
  },
  response: { 200: scheduleResponse },
} as const;

export const deleteIotScheduleSchema = { params: idParam } as const;
