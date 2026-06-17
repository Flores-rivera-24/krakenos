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
    online: { type: 'boolean' },
    sources: { type: 'array', items: { type: 'string', enum: ['arp', 'mdns', 'manual'] } },
    firstSeen: { type: 'string', format: 'date-time' },
    lastSeen: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'mac', 'ip', 'type', 'online', 'sources', 'firstSeen', 'lastSeen'],
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
