const deviceResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    kind: { type: 'string', enum: ['light', 'plug', 'sensor'] },
    room: { type: ['string', 'null'] },
    reachable: { type: 'boolean' },
    on: { type: ['boolean', 'null'] },
    brightness: { type: ['integer', 'null'] },
    reading: {
      type: ['object', 'null'],
      properties: {
        metric: { type: 'string' },
        value: { type: 'number' },
        unit: { type: 'string' },
      },
      required: ['metric', 'value', 'unit'],
    },
  },
  required: ['id', 'name', 'kind', 'room', 'reachable', 'on', 'brightness', 'reading'],
} as const;

export const listIotSchema = {
  response: {
    200: { type: 'array', items: deviceResponse },
  },
} as const;

export const updateIotSchema = {
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
      on: { type: 'boolean' },
      brightness: { type: 'integer', minimum: 0, maximum: 100 },
    },
  },
  response: {
    200: deviceResponse,
  },
} as const;
