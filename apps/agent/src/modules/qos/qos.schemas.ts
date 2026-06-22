const PRIORITIES = ['high', 'normal', 'low'] as const;

const ruleResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    priority: { type: 'string', enum: PRIORITIES },
    target: { type: 'string' },
    downloadKbps: { type: 'integer' },
    uploadKbps: { type: 'integer' },
    enabled: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'name',
    'priority',
    'target',
    'downloadKbps',
    'uploadKbps',
    'enabled',
    'createdAt',
  ],
} as const;

// Tope alto pero finito (10 Gbps) para evitar valores absurdos.
const kbps = { type: 'integer', minimum: 0, maximum: 10_000_000 } as const;

/**
 * Objetivo de la regla: una IP/CIDR (`10.0.0.5`, `192.168.1.0/24`) o un objetivo
 * por servicio (`service:zoom`). Empieza por alfanumérico y solo admite
 * `A-Za-z0-9 . : / _ -`: rechaza espacios, metacaracteres de shell y el `-`
 * inicial (inyección de bandera) antes de que un objetivo-IP llegue a `tc`.
 */
const target = {
  type: 'string',
  minLength: 1,
  maxLength: 64,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:/-]*$',
} as const;

export const listRulesSchema = {
  response: {
    200: { type: 'array', items: ruleResponse },
  },
} as const;

export const createRuleSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'target'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      target,
      priority: { type: 'string', enum: PRIORITIES },
      downloadKbps: kbps,
      uploadKbps: kbps,
      enabled: { type: 'boolean' },
    },
  },
  response: { 201: ruleResponse },
} as const;

export const updateRuleSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      target,
      priority: { type: 'string', enum: PRIORITIES },
      downloadKbps: kbps,
      uploadKbps: kbps,
      enabled: { type: 'boolean' },
    },
  },
  response: { 200: ruleResponse },
} as const;

export const removeRuleSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1 } },
  },
  response: { 204: { type: 'null' } },
} as const;
