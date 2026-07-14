const mqttConfig = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean' },
    url: { type: 'string' },
    username: { type: 'string' },
    hasPassword: { type: 'boolean' },
    topicPrefix: { type: 'string' },
    intervalSec: { type: 'number' },
    discovery: { type: 'boolean' },
    control: { type: 'boolean' },
  },
  required: [
    'enabled',
    'url',
    'username',
    'hasPassword',
    'topicPrefix',
    'intervalSec',
    'discovery',
    'control',
  ],
} as const;

const mqttStatus = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean' },
    connected: { type: 'boolean' },
    lastPublishAt: { type: ['string', 'null'] },
    lastError: { type: ['string', 'null'] },
  },
  required: ['enabled', 'connected', 'lastPublishAt', 'lastError'],
} as const;

const mqttResponse = {
  type: 'object',
  additionalProperties: false,
  properties: { config: mqttConfig, status: mqttStatus },
  required: ['config', 'status'],
} as const;

export const getMqttSchema = {
  response: { 200: mqttResponse },
} as const;

export const updateMqttSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean' },
      // Solo mqtt(s):// para no aceptar esquemas raros; el host se valida por egress.
      url: { type: 'string', maxLength: 200, pattern: '^mqtts?://' },
      username: { type: 'string', maxLength: 128 },
      password: { type: ['string', 'null'], maxLength: 256 },
      topicPrefix: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[\\w-]+$' },
      intervalSec: { type: 'integer', minimum: 5, maximum: 3600 },
      discovery: { type: 'boolean' },
      control: { type: 'boolean' },
    },
  },
  response: { 200: mqttResponse },
} as const;
