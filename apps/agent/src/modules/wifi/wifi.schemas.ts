const bandEnum = ['2.4GHz', '5GHz', '6GHz'];
const securityEnum = ['open', 'wpa2', 'wpa3', 'wpa2/wpa3'];

const wifiResponse = {
  type: 'object',
  properties: {
    ssid: { type: 'string' },
    enabled: { type: 'boolean' },
    band: { type: 'string', enum: bandEnum },
    security: { type: 'string', enum: securityEnum },
    hidden: { type: 'boolean' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['ssid', 'enabled', 'band', 'security', 'hidden', 'updatedAt'],
} as const;

const guestResponse = {
  type: 'object',
  properties: {
    ssid: { type: 'string' },
    enabled: { type: 'boolean' },
    clientIsolation: { type: 'boolean' },
    bandwidthLimitMbps: { type: ['integer', 'null'] },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['ssid', 'enabled', 'clientIsolation', 'bandwidthLimitMbps', 'updatedAt'],
} as const;

export const getWifiSchema = {
  response: { 200: wifiResponse },
} as const;

export const updateWifiSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      ssid: { type: 'string', minLength: 1, maxLength: 32 },
      password: { type: 'string', minLength: 8, maxLength: 63 },
      enabled: { type: 'boolean' },
      band: { type: 'string', enum: bandEnum },
      security: { type: 'string', enum: securityEnum },
      hidden: { type: 'boolean' },
    },
  },
  response: { 200: wifiResponse },
} as const;

export const getGuestSchema = {
  response: { 200: guestResponse },
} as const;

export const updateGuestSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      ssid: { type: 'string', minLength: 1, maxLength: 32 },
      password: { type: 'string', minLength: 8, maxLength: 63 },
      enabled: { type: 'boolean' },
      clientIsolation: { type: 'boolean' },
      bandwidthLimitMbps: { type: ['integer', 'null'], minimum: 1, maximum: 10000 },
    },
  },
  response: { 200: guestResponse },
} as const;
