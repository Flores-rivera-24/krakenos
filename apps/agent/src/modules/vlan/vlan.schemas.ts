const vlanResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    tag: { type: 'integer' },
    name: { type: 'string' },
    subnet: { type: ['string', 'null'] },
    isolated: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
    deviceCount: { type: 'integer' },
  },
  required: ['id', 'tag', 'name', 'subnet', 'isolated', 'createdAt', 'deviceCount'],
} as const;

const tag = { type: 'integer', minimum: 1, maximum: 4094 } as const;
const subnet = { type: ['string', 'null'], maxLength: 64 } as const;

export const listVlansSchema = {
  response: {
    200: { type: 'array', items: vlanResponse },
  },
} as const;

export const createVlanSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['tag', 'name'],
    properties: {
      tag,
      name: { type: 'string', minLength: 1, maxLength: 60 },
      subnet,
      isolated: { type: 'boolean' },
    },
  },
  // El tag puede chocar (409), por eso no se restringe la respuesta a 201.
} as const;

export const updateVlanSchema = {
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
      subnet,
      isolated: { type: 'boolean' },
    },
  },
} as const;

export const removeVlanSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1 } },
  },
} as const;
