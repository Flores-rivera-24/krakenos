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

const deviceStats = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mac: { type: 'string' },
    ip: { type: 'string' },
    label: { type: ['string', 'null'] },
    rxTotal: { type: 'number' },
    txTotal: { type: 'number' },
    samples: { type: 'array', items: bucket },
  },
  required: ['mac', 'ip', 'label', 'rxTotal', 'txTotal', 'samples'],
} as const;

export const deviceTrafficSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      range: { type: 'string', enum: ['hour', 'day', 'week'], default: 'hour' },
    },
  },
  response: {
    200: { type: 'array', items: deviceStats },
  },
} as const;
