import { IOT_DEVICE_KINDS, IOT_METRICS } from '@krakenos/types';

const deviceResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    // Derivado de `@krakenos/types`, no re-tecleado: una categoría nueva no puede
    // quedarse fuera del schema y ser podada en silencio (convención del proyecto).
    kind: { type: 'string', enum: IOT_DEVICE_KINDS },
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
    readings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: IOT_METRICS },
          value: { type: 'number' },
          unit: { type: 'string' },
        },
        required: ['metric', 'value', 'unit'],
      },
    },
    // US-244: estado de las categorías nuevas. Opcionales y anulables — la mayoría
    // de aparatos no son persianas ni termostatos, y `null` es la respuesta honesta.
    position: { type: ['integer', 'null'] },
    targetC: { type: ['number', 'null'] },
    locked: { type: ['boolean', 'null'] },
    // US-242: el driver los calculaba y el schema de respuesta los podaba, así que
    // el consumo instantáneo de un enchufe medidor no llegaba nunca a la UI. Van
    // como opcionales: la mayoría de aparatos no los miden y `null` es la respuesta
    // honesta (US-181).
    powerW: { type: ['number', 'null'] },
    energyWh: { type: ['number', 'null'] },
  },
  required: ['id', 'name', 'kind', 'room', 'reachable', 'on', 'brightness', 'color', 'readings'],
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
  /**
   * **Bolsa unificada + `allOf` de `if/then`** (US-244), nunca `oneOf` de ramas con
   * `additionalProperties: false`: el `removeAdditional` de ajv haría que una rama
   * fallida **pode** las propiedades de la rama correcta, produciendo un 400
   * imposible de casar (trampa documentada en `CLAUDE.md`). Las subramas de abajo
   * solo usan `required`/`not`, así que no hay nada que podar.
   *
   * Lo que expresan: `position` (persiana) y `targetC` (termostato) pertenecen a
   * categorías distintas de `brightness`/`color` (luz), y mezclarlas en una misma
   * petición es siempre un error del cliente. El schema **no** puede comprobar que
   * el campo case con la categoría del aparato —esa vive en el path, no en el
   * cuerpo—: eso lo impone el manager, que rechaza lo que no aplica.
   *
   * ⚠️ No hay campo para la cerradura: US-246 decide antes su política.
   */
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
      position: { type: 'integer', minimum: 0, maximum: 100 },
      targetC: { type: 'number', minimum: 4, maximum: 35 },
    },
    allOf: [
      {
        if: { required: ['position'] },
        then: {
          not: {
            anyOf: [
              { required: ['brightness'] },
              { required: ['color'] },
              { required: ['targetC'] },
            ],
          },
        },
      },
      {
        if: { required: ['targetC'] },
        then: {
          not: {
            anyOf: [
              { required: ['brightness'] },
              { required: ['color'] },
              { required: ['on'] },
            ],
          },
        },
      },
    ],
  },
  response: {
    200: deviceResponse,
  },
} as const;
