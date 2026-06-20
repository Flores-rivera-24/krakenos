const ACTIONS = ['allow', 'deny'] as const;
const PROTOCOLS = ['tcp', 'udp', 'any'] as const;

const ruleResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    action: { type: 'string', enum: ACTIONS },
    protocol: { type: 'string', enum: PROTOCOLS },
    source: { type: ['string', 'null'] },
    destination: { type: ['string', 'null'] },
    port: { type: ['integer', 'null'] },
    enabled: { type: 'boolean' },
    priority: { type: 'integer' },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: [
    'id',
    'name',
    'action',
    'protocol',
    'source',
    'destination',
    'port',
    'enabled',
    'priority',
    'createdAt',
  ],
} as const;

/**
 * IPv4/IPv6 con máscara CIDR opcional. Defensa en profundidad: el valor acaba
 * en `iptables -s/-d`, así que se rechaza cualquier cosa con espacios, guiones
 * iniciales u otros caracteres que no sean una dirección/red válida.
 */
const IP_CIDR_PATTERN =
  '^((\\d{1,3}\\.){3}\\d{1,3}(/\\d{1,2})?|[0-9A-Fa-f:]+(/\\d{1,3})?)$';
const source = {
  type: ['string', 'null'],
  maxLength: 64,
  pattern: IP_CIDR_PATTERN,
} as const;
const port = { type: ['integer', 'null'], minimum: 1, maximum: 65535 } as const;

export const listRulesSchema = {
  response: {
    200: { type: 'array', items: ruleResponse },
  },
} as const;

export const createRuleSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'action'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      action: { type: 'string', enum: ACTIONS },
      protocol: { type: 'string', enum: PROTOCOLS },
      source,
      destination: source,
      port,
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
      action: { type: 'string', enum: ACTIONS },
      protocol: { type: 'string', enum: PROTOCOLS },
      source,
      destination: source,
      port,
      enabled: { type: 'boolean' },
      priority: { type: 'integer', minimum: 0 },
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
} as const;
