const VERSION_ENUM = ['3.1', '3.3', '3.4'] as const;

/** Vista pública de un dispositivo Tuya: **nunca** incluye `localKey`. */
const publicDeviceResponse = {
  type: 'object',
  properties: {
    deviceId: { type: 'string' },
    ip: { type: 'string' },
    name: { type: 'string' },
    version: { type: 'string', enum: VERSION_ENUM },
  },
  required: ['deviceId', 'ip', 'name'],
} as const;

export const listTuyaSchema = {
  response: {
    200: { type: 'array', items: publicDeviceResponse },
  },
} as const;

export const createTuyaSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['deviceId', 'localKey', 'ip', 'name'],
    properties: {
      deviceId: { type: 'string', minLength: 1, maxLength: 64 },
      localKey: { type: 'string', minLength: 1, maxLength: 64 },
      ip: { type: 'string', minLength: 1, maxLength: 64 },
      name: { type: 'string', minLength: 1, maxLength: 80 },
      version: { type: 'string', enum: VERSION_ENUM },
    },
  },
  response: {
    201: publicDeviceResponse,
  },
} as const;

export const updateTuyaSchema = {
  params: {
    type: 'object',
    required: ['deviceId'],
    properties: { deviceId: { type: 'string', minLength: 1 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      ip: { type: 'string', minLength: 1, maxLength: 64 },
      localKey: { type: 'string', minLength: 1, maxLength: 64 },
      name: { type: 'string', minLength: 1, maxLength: 80 },
    },
  },
  response: {
    200: publicDeviceResponse,
  },
} as const;

export const removeTuyaSchema = {
  params: {
    type: 'object',
    required: ['deviceId'],
    properties: { deviceId: { type: 'string', minLength: 1 } },
  },
} as const;
