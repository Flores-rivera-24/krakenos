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
      },
      required: ['range', 'people'],
    },
  },
} as const;
