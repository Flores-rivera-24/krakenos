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
    color: {
      type: ['object', 'null'],
      properties: {
        hex: { type: ['string', 'null'] },
        temperatureK: { type: ['integer', 'null'] },
      },
      required: ['hex', 'temperatureK'],
    },
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
  required: ['id', 'name', 'kind', 'room', 'reachable', 'on', 'brightness', 'color', 'reading'],
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
      color: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          hex: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
          temperatureK: { type: 'integer', minimum: 1000, maximum: 10000 },
        },
      },
    },
  },
  response: {
    200: deviceResponse,
  },
} as const;
