/** JSON Schemas de los horarios de acceso / control parental (US-108). */

const days = {
  type: 'array',
  items: { type: 'integer', minimum: 0, maximum: 6 },
  minItems: 1,
  maxItems: 7,
} as const;

const minute = { type: 'integer', minimum: 0, maximum: 1439 } as const;

const scheduleResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'mac', 'enabled', 'days', 'startMinute', 'endMinute', 'createdAt'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    mac: { type: 'string' },
    enabled: { type: 'boolean' },
    days: { type: 'array', items: { type: 'integer' } },
    startMinute: { type: 'integer' },
    endMinute: { type: 'integer' },
    createdAt: { type: 'string' },
  },
} as const;

const idParam = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
} as const;

export const listSchedulesSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { mac: { type: 'string', maxLength: 64 } },
  },
  response: { 200: { type: 'array', items: scheduleResponse } },
} as const;

export const createScheduleSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'mac', 'days', 'startMinute', 'endMinute'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      mac: { type: 'string', minLength: 1, maxLength: 64 },
      days,
      startMinute: minute,
      endMinute: minute,
      enabled: { type: 'boolean' },
    },
  },
  response: { 201: scheduleResponse },
} as const;

export const updateScheduleSchema = {
  params: idParam,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      enabled: { type: 'boolean' },
      days,
      startMinute: minute,
      endMinute: minute,
    },
  },
  response: { 200: scheduleResponse },
} as const;

export const deleteScheduleSchema = { params: idParam } as const;
