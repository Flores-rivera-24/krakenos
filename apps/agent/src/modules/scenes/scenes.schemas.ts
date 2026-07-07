/** JSON Schemas de escenas (US-166). */

const SCENE_ICONS = [
  'night',
  'movie',
  'leave',
  'morning',
  'dinner',
  'relax',
  'party',
  'focus',
  'scene',
] as const;

const icon = { type: 'string', enum: SCENE_ICONS } as const;
const order = { type: 'integer', minimum: 0, maximum: 100000 } as const;

const sceneAction = {
  type: 'object',
  additionalProperties: false,
  required: ['deviceId'],
  properties: {
    deviceId: { type: 'string', minLength: 1, maxLength: 128 },
    on: { type: 'boolean' },
    brightness: { type: 'integer', minimum: 0, maximum: 100 },
    color: {
      type: 'object',
      additionalProperties: false,
      properties: {
        hex: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        temperatureK: { type: 'integer', minimum: 1000, maximum: 10000 },
      },
    },
  },
} as const;

const actions = { type: 'array', items: sceneAction, maxItems: 200 } as const;

const sceneResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'icon', 'actions', 'order', 'createdAt'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    icon: { type: 'string' },
    actions,
    order: { type: 'integer' },
    createdAt: { type: 'string' },
  },
} as const;

const idParam = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
} as const;

export const listScenesSchema = {
  response: { 200: { type: 'array', items: sceneResponse } },
} as const;

export const createSceneSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'actions'],
    properties: { name: { type: 'string', minLength: 1, maxLength: 60 }, icon, actions, order },
  },
  response: { 201: sceneResponse },
} as const;

export const updateSceneSchema = {
  params: idParam,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: { name: { type: 'string', minLength: 1, maxLength: 60 }, icon, actions, order },
  },
  response: { 200: sceneResponse },
} as const;

export const deleteSceneSchema = { params: idParam } as const;

const runResult = {
  type: 'object',
  additionalProperties: false,
  required: ['applied', 'failed'],
  properties: {
    applied: { type: 'integer' },
    failed: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['deviceId', 'error'],
        properties: { deviceId: { type: 'string' }, error: { type: 'string' } },
      },
    },
  },
} as const;

export const runSceneSchema = {
  params: idParam,
  response: { 200: runResult },
} as const;

export const captureSceneSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['deviceIds'],
    properties: {
      deviceIds: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 200 },
    },
  },
  response: { 200: actions },
} as const;
