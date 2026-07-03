const blockedDomainResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    domain: { type: 'string' },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'domain', 'createdAt'],
} as const;

const queryResponse = {
  type: 'object',
  properties: {
    timestamp: { type: 'string', format: 'date-time' },
    domain: { type: 'string' },
    client: { type: 'string' },
    blocked: { type: 'boolean' },
  },
  required: ['timestamp', 'domain', 'client', 'blocked'],
} as const;

export const dnsStatsSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        totalQueries: { type: 'integer' },
        blockedQueries: { type: 'integer' },
        blockedPercent: { type: 'integer' },
        blocklistSize: { type: 'integer' },
      },
      required: ['totalQueries', 'blockedQueries', 'blockedPercent', 'blocklistSize'],
    },
  },
} as const;

export const listBlockedSchema = {
  response: {
    200: { type: 'array', items: blockedDomainResponse },
  },
} as const;

export const addBlockedSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['domain'],
    properties: {
      // Dominio válido (etiquetas alfanuméricas separadas por puntos).
      domain: {
        type: 'string',
        minLength: 3,
        maxLength: 253,
        pattern: '^(?=.{1,253}$)([a-zA-Z0-9](-?[a-zA-Z0-9])*\\.)+[a-zA-Z]{2,}$',
      },
    },
  },
  response: { 201: blockedDomainResponse },
} as const;

export const removeBlockedSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1 } },
  },
  response: { 204: { type: 'null' } },
} as const;

export const recentQueriesSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    },
  },
  response: {
    200: { type: 'array', items: queryResponse },
  },
} as const;

/** Feed de categoría (adlist) — US-114. */
const feed = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'description', 'url', 'enabled'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string' },
    url: { type: 'string' },
    enabled: { type: 'boolean' },
  },
} as const;

export const listFeedsSchema = {
  response: { 200: { type: 'array', items: feed } },
} as const;

export const updateFeedSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['enabled'],
    properties: { enabled: { type: 'boolean' } },
  },
  response: { 200: feed },
} as const;
