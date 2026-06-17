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
