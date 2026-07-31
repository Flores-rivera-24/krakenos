/** JSON Schemas de los horarios de acceso / control parental (US-108). */

// MAC en los cuerpos de entrada: acepta hex separado por `:`/`-` (todos los
// formatos reales), y rechaza control/`;`/espacios. Defensa temprana; el driver
// re-normaliza antes de tocar el hardware (`normalizeMac`).
const MAC_PATTERN = '^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$';

const days = {
  type: 'array',
  items: { type: 'integer', minimum: 0, maximum: 6 },
  minItems: 1,
  maxItems: 7,
} as const;

const minute = { type: 'integer', minimum: 0, maximum: 1439 } as const;

const scheduleResponse = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'mac',
    'enabled',
    'days',
    'startMinute',
    'endMinute',
    'personId',
    'createdAt',
  ],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    mac: { type: 'string' },
    enabled: { type: 'boolean' },
    days: { type: 'array', items: { type: 'integer' } },
    startMinute: { type: 'integer' },
    endMinute: { type: 'integer' },
    // US-240: quién manda sobre este horario. La UI del dispositivo lo necesita
    // para marcarlo como heredado de la persona en vez de dejar que el usuario
    // lo edite creyendo que solo toca este aparato.
    personId: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
  },
} as const;

const idParam = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
} as const;

export const listSchedulesSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { mac: { type: 'string', maxLength: 64 } },
  },
  response: { 200: { type: 'array', items: scheduleResponse } },
} as const;

export const createScheduleSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'mac', 'days', 'startMinute', 'endMinute'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      mac: { type: 'string', minLength: 1, maxLength: 64, pattern: MAC_PATTERN },
      days,
      startMinute: minute,
      endMinute: minute,
      enabled: { type: 'boolean' },
    },
  },
  response: { 201: scheduleResponse },
} as const;

export const updateScheduleSchema = {
  params: idParam,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      enabled: { type: 'boolean' },
      days,
      startMinute: minute,
      endMinute: minute,
    },
  },
  response: { 200: scheduleResponse },
} as const;

export const deleteScheduleSchema = { params: idParam } as const;

const mac = { type: 'string', minLength: 1, maxLength: 64, pattern: MAC_PATTERN } as const;

/** `POST /api/access/pause` — pausa el internet de un dispositivo N minutos (US-111). */
export const pauseSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['mac', 'minutes'],
    properties: { mac, minutes: { type: 'integer', minimum: 1, maximum: 1440 } },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['pausedUntil'],
      properties: { pausedUntil: { type: 'string' } },
    },
  },
} as const;

/** `POST /api/access/resume` — reanuda el internet de un dispositivo (US-111). */
export const resumeSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['mac'],
    properties: { mac },
  },
  response: { 204: { type: 'null' } },
} as const;
