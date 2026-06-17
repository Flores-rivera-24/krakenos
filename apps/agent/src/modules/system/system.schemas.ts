export const systemStatsSchema = {
  response: {
    200: {
      type: 'object',
      properties: {
        uptimeSeconds: { type: 'number' },
        cpu: {
          type: 'object',
          properties: {
            cores: { type: 'integer' },
            loadPercent: { type: 'number' },
          },
          required: ['cores', 'loadPercent'],
        },
        memory: {
          type: 'object',
          properties: {
            totalBytes: { type: 'number' },
            usedBytes: { type: 'number' },
            usedPercent: { type: 'number' },
          },
          required: ['totalBytes', 'usedBytes', 'usedPercent'],
        },
        timestamp: { type: 'string', format: 'date-time' },
      },
      required: ['uptimeSeconds', 'cpu', 'memory', 'timestamp'],
    },
  },
} as const;
