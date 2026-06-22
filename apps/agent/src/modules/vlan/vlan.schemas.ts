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
/**
 * Nombre de VLAN: el valor se interpola en CLI IOS (`name <x>`) y en un
 * OctetString SNMP. Allowlist estricta (`A-Za-z0-9 _ . -`, máx. 32 = límite de
 * IOS) que rechaza espacios, saltos de línea y metacaracteres → cierra la
 * inyección de comandos IOS por salto de línea.
 */
const name = {
  type: 'string',
  minLength: 1,
  maxLength: 32,
  pattern: '^[A-Za-z0-9_.][A-Za-z0-9_.-]*$',
} as const;

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
      name,
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
      name,
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
  response: { 204: { type: 'null' } },
} as const;
