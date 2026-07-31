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
    // US-242: el driver los calculaba y el schema de respuesta los podaba, así que
    // el consumo instantáneo de un enchufe medidor no llegaba nunca a la UI. Van
    // como opcionales: la mayoría de aparatos no los miden y `null` es la respuesta
    // honesta (US-181).
    powerW: { type: ['number', 'null'] },
    energyWh: { type: ['number', 'null'] },
  },
  required: ['id', 'name', 'kind', 'room', 'reachable', 'on', 'brightness', 'color', 'reading'],
} as const;

export const listIotSchema = {
  response: {
    200: { type: 'array', items: deviceResponse },
  },
} as const;

const errorResponse = {
  type: 'object',
  properties: { code: { type: 'string' }, message: { type: 'string' } },
  required: ['code', 'message'],
} as const;

/** Comisionado de un dispositivo Matter (US-172). */
export const commissionMatterSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['code'],
    // QR (`MT:…`, ~22+ chars) o código manual de 11 dígitos (con o sin guiones).
    properties: { code: { type: 'string', minLength: 5, maxLength: 64 } },
  },
  response: {
    201: {
      type: 'object',
      additionalProperties: false,
      properties: { deviceId: { type: 'string' }, name: { type: 'string' } },
      required: ['deviceId', 'name'],
    },
    400: errorResponse,
    409: errorResponse,
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
