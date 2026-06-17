const deviceTypeEnum = ['router', 'computer', 'phone', 'tablet', 'iot', 'tv', 'printer', 'unknown'];

const deviceResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    mac: { type: 'string' },
    ip: { type: 'string' },
    hostname: { type: ['string', 'null'] },
    label: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    vendor: { type: ['string', 'null'] },
    type: { type: 'string', enum: deviceTypeEnum },
    isBlocked: { type: 'boolean' },
    online: { type: 'boolean' },
    vlanTag: { type: ['integer', 'null'] },
    sources: { type: 'array', items: { type: 'string', enum: ['arp', 'mdns', 'manual'] } },
    firstSeen: { type: 'string', format: 'date-time' },
    lastSeen: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'mac', 'ip', 'type', 'isBlocked', 'online', 'sources', 'firstSeen', 'lastSeen'],
} as const;

export const blockDeviceSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1 } },
  },
  response: {
    200: deviceResponse,
  },
} as const;

export const listDevicesSchema = {
  response: {
    200: { type: 'array', items: deviceResponse },
  },
} as const;

export const updateDeviceSchema = {
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
      label: { type: ['string', 'null'], maxLength: 64 },
      type: { type: 'string', enum: deviceTypeEnum },
      notes: { type: ['string', 'null'], maxLength: 500 },
    },
  },
  response: {
    200: deviceResponse,
  },
} as const;

export const rescanSchema = {
  response: {
    200: { type: 'array', items: deviceResponse },
  },
} as const;

export const setVlanSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['tag'],
    properties: {
      tag: { type: ['integer', 'null'], minimum: 1, maximum: 4094 },
    },
  },
  response: {
    200: deviceResponse,
  },
} as const;
