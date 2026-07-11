import { errorResponse } from '../common.schemas.js';

const alarmStateResponse = {
  type: 'object',
  properties: {
    phase: { enum: ['disarmed', 'arming', 'armed', 'entry', 'triggered'] },
    mode: { type: ['string', 'null'], enum: ['away', 'night', null] },
    since: { type: 'string', format: 'date-time' },
    countdownEndsAt: { type: ['string', 'null'] },
    triggeredBy: { type: ['string', 'null'] },
  },
  required: ['phase', 'mode', 'since', 'countdownEndsAt', 'triggeredBy'],
} as const;

const alarmConfigResponse = {
  type: 'object',
  properties: {
    sirenDeviceId: { type: ['string', 'null'] },
    lightDeviceIds: { type: 'array', items: { type: 'string' } },
    sensorDeviceIds: { type: 'array', items: { type: 'string' } },
    cameraIds: { type: 'array', items: { type: 'string' } },
    exitDelaySec: { type: 'integer' },
    entryDelaySec: { type: 'integer' },
    autoArmAway: { type: 'boolean' },
    hasPin: { type: 'boolean' },
  },
  required: [
    'sirenDeviceId',
    'lightDeviceIds',
    'sensorDeviceIds',
    'cameraIds',
    'exitDelaySec',
    'entryDelaySec',
    'autoArmAway',
    'hasPin',
  ],
} as const;

export const getAlarmStateSchema = {
  response: { 200: alarmStateResponse },
} as const;

export const armAlarmSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['mode'],
    properties: { mode: { enum: ['away', 'night'] } },
  },
  response: { 200: alarmStateResponse, 400: errorResponse },
} as const;

export const disarmAlarmSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { pin: { type: 'string', minLength: 1, maxLength: 32 } },
  },
  response: { 200: alarmStateResponse, 401: errorResponse },
} as const;

export const getAlarmConfigSchema = {
  response: { 200: alarmConfigResponse },
} as const;

const idArray = { type: 'array', maxItems: 64, items: { type: 'string', minLength: 1, maxLength: 128 } } as const;

export const updateAlarmConfigSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      sirenDeviceId: { type: ['string', 'null'], maxLength: 128 },
      lightDeviceIds: idArray,
      sensorDeviceIds: idArray,
      cameraIds: idArray,
      exitDelaySec: { type: 'integer', minimum: 0, maximum: 300 },
      entryDelaySec: { type: 'integer', minimum: 0, maximum: 300 },
      autoArmAway: { type: 'boolean' },
      // PIN: string lo pone, null lo quita. Nunca se devuelve.
      pin: { type: ['string', 'null'], minLength: 4, maxLength: 32 },
    },
  },
  response: { 200: alarmConfigResponse },
} as const;
