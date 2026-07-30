const usageBucket = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timestamp: { type: 'string', format: 'date-time' },
    bytes: { type: 'number' },
  },
  required: ['timestamp', 'bytes'],
} as const;

const personUsage = {
  type: 'object',
  additionalProperties: false,
  properties: {
    userId: { type: ['string', 'null'] },
    name: { type: 'string' },
    rxBytes: { type: 'number' },
    txBytes: { type: 'number' },
    totalBytes: { type: 'number' },
    deviceCount: { type: 'integer' },
    buckets: { type: 'array', items: usageBucket },
  },
  required: ['userId', 'name', 'rxBytes', 'txBytes', 'totalBytes', 'deviceCount', 'buckets'],
} as const;

const perDeviceTraffic = {
  type: 'object',
  additionalProperties: false,
  required: ['status'],
  properties: {
    // US-251: tres estados, no un booleano. `requires-setup` es el único que el
    // usuario puede arreglar, y la UI necesita poder decirle cómo.
    status: { type: 'string', enum: ['supported', 'unsupported', 'requires-setup'] },
    setup: { type: 'string', enum: ['nlbwmon'] },
  },
} as const;

export const wellbeingUsageSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      range: { type: 'string', enum: ['day', 'week'], default: 'week' },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      properties: {
        range: { type: 'string', enum: ['day', 'week'] },
        people: { type: 'array', items: personUsage },
        // US-263: sin desglose por dispositivo, `people` sale vacío SIEMPRE, por
        // mucho dueño que se asigne. La UI necesita distinguirlo.
        perDeviceTraffic,
        devicesWithOwner: { type: 'integer' },
      },
      required: ['range', 'people', 'perDeviceTraffic', 'devicesWithOwner'],
    },
  },
} as const;
