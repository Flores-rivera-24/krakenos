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

// ---- Multi-AP (Fase 2) ----

const accessPointResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    model: { type: ['string', 'null'] },
    ip: { type: 'string' },
    online: { type: 'boolean' },
    networkCount: { type: 'integer' },
  },
  required: ['id', 'name', 'model', 'ip', 'online', 'networkCount'],
} as const;

const networkInfoResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    apId: { type: 'string' },
    ssid: { type: 'string' },
    band: { type: 'string', enum: bandEnum },
    security: { type: 'string', enum: securityEnum },
    enabled: { type: 'boolean' },
    hidden: { type: 'boolean' },
    isGuest: { type: 'boolean' },
    clientCount: { type: 'integer' },
  },
  required: ['id', 'apId', 'ssid', 'band', 'security', 'enabled', 'hidden', 'isGuest', 'clientCount'],
} as const;

const clientResponse = {
  type: 'object',
  properties: {
    mac: { type: 'string' },
    hostname: { type: ['string', 'null'] },
    ip: { type: 'string' },
    signalDbm: { type: 'integer' },
  },
  required: ['mac', 'hostname', 'ip', 'signalDbm'],
} as const;

const networkIdParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
} as const;

export const accessPointsSchema = {
  response: { 200: { type: 'array', items: accessPointResponse } },
} as const;

export const networksSchema = {
  response: { 200: { type: 'array', items: networkInfoResponse } },
} as const;

export const getNetworkSchema = {
  params: networkIdParams,
  response: { 200: networkInfoResponse },
} as const;

export const updateNetworkSchema = {
  params: networkIdParams,
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
  response: { 200: networkInfoResponse },
} as const;

export const networkClientsSchema = {
  params: networkIdParams,
  response: { 200: { type: 'array', items: clientResponse } },
} as const;
