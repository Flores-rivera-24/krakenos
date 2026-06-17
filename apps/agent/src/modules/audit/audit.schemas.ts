export const listAuditSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
    },
  },
  response: {
    200: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          action: { type: 'string' },
          userId: { type: ['string', 'null'] },
          detail: { type: ['string', 'null'] },
          ip: { type: ['string', 'null'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
        required: ['id', 'action', 'userId', 'detail', 'ip', 'createdAt'],
      },
    },
  },
} as const;
