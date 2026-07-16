import { HOME_MODES } from '@krakenos/types';
import { errorResponse } from '../common.schemas.js';

/** JSON Schemas de automatizaciones «si X entonces Y» (US-167). */

const days = {
  type: 'array',
  items: { type: 'integer', minimum: 0, maximum: 6 },
  minItems: 1,
  maxItems: 7,
} as const;

const mac = { type: 'string', minLength: 1, maxLength: 64 } as const;
const deviceId = { type: 'string', minLength: 1, maxLength: 128 } as const;

// Disparador: evento de red/IoT, umbral de sensor u hora fija. Bolsa unificada
// de propiedades + `if/then` por tipo — un `oneOf` de ramas con
// `additionalProperties:false` es incompatible con el `removeAdditional` de ajv
// (la rama fallida PODA las propiedades de la rama correcta antes de evaluarla).
const trigger = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: {
      enum: [
        'device-new',
        'device-online',
        'device-offline',
        'iot-on',
        'iot-off',
        'sensor-threshold',
        'energy-threshold',
        'motion-detected',
        'time',
        'person-arrived',
        'person-left',
        'mode-changed',
      ],
    },
    mac,
    deviceId,
    op: { enum: ['gt', 'lt'] },
    value: { type: 'number', minimum: -1_000_000, maximum: 1_000_000 },
    days,
    minute: { type: 'integer', minimum: 0, maximum: 1439 },
    // Presencia/modos (US-169): `userId` opcional (ausente = cualquier persona).
    userId: { type: 'string', minLength: 1, maxLength: 128 },
    mode: { enum: [...HOME_MODES] },
    // Movimiento (US-186): `cameraId` opcional (ausente = cualquier cámara).
    cameraId: { type: 'string', minLength: 1, maxLength: 128 },
    // Objeto detectado (Frigate, US-214): opcional (ausente = cualquier detección).
    // Vocabulario del detector (person/car/dog/…): minúsculas simples.
    label: { type: 'string', minLength: 1, maxLength: 32, pattern: '^[a-z_]+$' },
  },
  allOf: [
    {
      if: { properties: { type: { enum: ['device-online', 'device-offline'] } }, required: ['type'] },
      then: { required: ['mac'] },
    },
    {
      if: { properties: { type: { enum: ['iot-on', 'iot-off'] } }, required: ['type'] },
      then: { required: ['deviceId'] },
    },
    {
      if: { properties: { type: { const: 'sensor-threshold' } }, required: ['type'] },
      then: { required: ['deviceId', 'op', 'value'] },
    },
    {
      if: { properties: { type: { const: 'time' } }, required: ['type'] },
      then: { required: ['days', 'minute'] },
    },
    {
      if: { properties: { type: { const: 'mode-changed' } }, required: ['type'] },
      then: { required: ['mode'] },
    },
  ],
} as const;

// Condición opcional: ventana de días y/u horas.
const condition = {
  type: 'object',
  additionalProperties: false,
  properties: {
    days,
    fromMinute: { type: 'integer', minimum: 0, maximum: 1439 },
    toMinute: { type: 'integer', minimum: 0, maximum: 1439 },
  },
} as const;

// Acción: IoT, escena, bloquear/pausar internet o notificar (mismo patrón
// unificado + `if/then` que el disparador, por el `removeAdditional` de ajv).
const action = {
  type: 'object',
  additionalProperties: false,
  required: ['type'],
  properties: {
    type: { enum: ['iot-set', 'scene-run', 'device-block', 'device-pause', 'notify'] },
    deviceId,
    on: { type: 'boolean' },
    brightness: { type: 'integer', minimum: 0, maximum: 100 },
    sceneId: deviceId,
    mac,
    minutes: { type: 'integer', minimum: 1, maximum: 1440 },
    message: { type: 'string', minLength: 1, maxLength: 200 },
  },
  allOf: [
    {
      if: { properties: { type: { const: 'scene-run' } }, required: ['type'] },
      then: { required: ['sceneId'] },
    },
    {
      if: { properties: { type: { const: 'device-pause' } }, required: ['type'] },
      then: { required: ['minutes'] },
    },
    {
      if: { properties: { type: { const: 'notify' } }, required: ['type'] },
      then: { required: ['message'] },
    },
  ],
} as const;

const actions = { type: 'array', items: action, minItems: 1, maxItems: 10 } as const;

/** Anti-ruido/anti-bucle: mínimo 5 s entre disparos de la misma regla. */
const cooldownSec = { type: 'integer', minimum: 5, maximum: 86_400 } as const;

const ruleResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'enabled', 'trigger', 'actions', 'cooldownSec', 'createdAt'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    enabled: { type: 'boolean' },
    trigger: { type: 'object', additionalProperties: true },
    condition: { type: 'object', additionalProperties: true },
    actions: { type: 'array', items: { type: 'object', additionalProperties: true } },
    cooldownSec: { type: 'integer' },
    createdAt: { type: 'string' },
  },
} as const;

const runResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'ruleId', 'event', 'ok', 'detail', 'createdAt'],
  properties: {
    id: { type: 'string' },
    ruleId: { type: 'string' },
    event: { type: 'string' },
    ok: { type: 'boolean' },
    detail: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
  },
} as const;

const idParam = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
} as const;

export const listAutomationsSchema = {
  response: { 200: { type: 'array', items: ruleResponse } },
} as const;

export const createAutomationSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'trigger', 'actions'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      enabled: { type: 'boolean' },
      trigger,
      condition,
      actions,
      cooldownSec,
    },
  },
  response: { 201: ruleResponse },
} as const;

export const updateAutomationSchema = {
  params: idParam,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      enabled: { type: 'boolean' },
      trigger,
      condition: { oneOf: [condition, { type: 'null' }] },
      actions,
      cooldownSec,
    },
  },
  response: { 200: ruleResponse, 404: errorResponse },
} as const;

export const deleteAutomationSchema = {
  params: idParam,
  response: { 204: { type: 'null' }, 404: errorResponse },
} as const;

export const listAutomationRunsSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { ruleId: { type: 'string', minLength: 1 } },
  },
  response: { 200: { type: 'array', items: runResponse } },
} as const;
