const sample = {
  type: 'object',
  properties: {
    timestamp: { type: 'string', format: 'date-time' },
    rxBytesPerSec: { type: 'number' },
    txBytesPerSec: { type: 'number' },
  },
  required: ['timestamp', 'rxBytesPerSec', 'txBytesPerSec'],
} as const;

export const trafficHistorySchema = {
  response: {
    200: { type: 'array', items: sample },
  },
} as const;

const bucket = {
  type: 'object',
  properties: {
    timestamp: { type: 'string', format: 'date-time' },
    rxBytesPerSec: { type: 'number' },
    txBytesPerSec: { type: 'number' },
  },
  required: ['timestamp', 'rxBytesPerSec', 'txBytesPerSec'],
} as const;

export const trafficStatsSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      range: { type: 'string', enum: ['hour', 'day', 'week'], default: 'day' },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      properties: {
        range: { type: 'string', enum: ['hour', 'day', 'week'] },
        buckets: { type: 'array', items: bucket },
        totalRxBytes: { type: 'number' },
        totalTxBytes: { type: 'number' },
      },
      required: ['range', 'buckets', 'totalRxBytes', 'totalTxBytes'],
    },
  },
} as const;
