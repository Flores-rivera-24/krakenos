import { errorResponse } from '../common.schemas.js';

const cameraResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    room: { type: ['string', 'null'] },
    model: { type: ['string', 'null'] },
    online: { type: 'boolean' },
  },
  required: ['id', 'name', 'room', 'model', 'online'],
} as const;

export const listCamerasSchema = {
  response: {
    200: { type: 'array', items: cameraResponse },
  },
} as const;

export const snapshotSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1 } },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        cameraId: { type: 'string' },
        image: { type: 'string' },
        capturedAt: { type: 'string', format: 'date-time' },
      },
      required: ['cameraId', 'image', 'capturedAt'],
    },
    404: errorResponse,
  },
} as const;

const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
} as const;

const managedCameraResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    room: { type: ['string', 'null'] },
    model: { type: ['string', 'null'] },
    enabled: { type: 'boolean' },
  },
  required: ['id', 'name', 'room', 'model', 'enabled'],
} as const;

const cameraBodyProps = {
  name: { type: 'string', minLength: 1, maxLength: 80 },
  // Solo `rtsp://` (o `rtsps://`). Sin restringir el esquema, la URL llega a
  // `ffmpeg -i`, que acepta `file://` (LFI), `http://` (SSRF a metadata/interno),
  // `concat:`, etc. La salida forzada a JPEG limita la exfiltración de ficheros,
  // pero el SSRF sí sería efectivo. Se acota a RTSP en el borde.
  rtspUrl: { type: 'string', minLength: 1, maxLength: 2048, pattern: '^rtsps?://' },
  room: { type: ['string', 'null'], maxLength: 80 },
  model: { type: ['string', 'null'], maxLength: 80 },
  enabled: { type: 'boolean' },
} as const;

export const createCameraSchema = {
  body: {
    type: 'object',
    required: ['name', 'rtspUrl'],
    additionalProperties: false,
    properties: cameraBodyProps,
  },
  response: { 201: managedCameraResponse },
} as const;

export const updateCameraSchema = {
  params: idParams,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: cameraBodyProps,
  },
  response: { 200: managedCameraResponse, 404: errorResponse },
} as const;

export const removeCameraSchema = {
  params: idParams,
  response: { 204: { type: 'null' }, 404: errorResponse },
} as const;

// --- Streaming HLS en vivo (US-185) ---

/**
 * Query con el token de stream efímero (`?st=`), común a playlist y segmento.
 * `st` **no** es `required` a propósito: su ausencia la resuelve el handler con
 * un 401 (no un 400 de validación), coherente con «falta autenticación».
 */
const streamTokenQuery = {
  type: 'object',
  properties: { st: { type: 'string', minLength: 1, maxLength: 4096 } },
} as const;

export const startStreamSchema = {
  params: idParams,
  response: {
    201: {
      type: 'object',
      properties: {
        cameraId: { type: 'string' },
        startedAt: { type: 'string', format: 'date-time' },
        /** Token efímero a poner en `?st=` de la playlist/segmentos. */
        token: { type: 'string' },
        /** Segundos de validez del token (para refrescarlo antes de que caduque). */
        expiresIn: { type: 'integer' },
      },
      required: ['cameraId', 'startedAt', 'token', 'expiresIn'],
    },
    404: errorResponse,
    429: errorResponse,
  },
} as const;

export const stopStreamSchema = {
  params: idParams,
  response: { 204: { type: 'null' }, 404: errorResponse },
} as const;

/**
 * Playlist y segmento se sirven con **content-type binario/HLS** y validan el
 * token en la query (no el access token del header): por eso no declaran un
 * `response` JSON — Fastify deja pasar el `reply.type(...).send(...)` tal cual.
 */
export const streamPlaylistSchema = {
  params: idParams,
  querystring: streamTokenQuery,
} as const;

export const streamSegmentSchema = {
  params: {
    type: 'object',
    required: ['id', 'segment'],
    properties: {
      id: { type: 'string', minLength: 1 },
      segment: { type: 'string', minLength: 1, maxLength: 128 },
    },
  },
  querystring: streamTokenQuery,
} as const;

// --- Detección de movimiento (US-186) ---

const motionArming = {
  type: 'object',
  additionalProperties: false,
  required: ['mode'],
  properties: {
    mode: { enum: ['always', 'never', 'schedule'] },
    windows: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['fromMinute', 'toMinute'],
        properties: {
          fromMinute: { type: 'integer', minimum: 0, maximum: 1439 },
          toMinute: { type: 'integer', minimum: 0, maximum: 1439 },
          days: { type: 'array', maxItems: 7, items: { type: 'integer', minimum: 0, maximum: 6 } },
        },
      },
    },
  },
} as const;

const motionConfigResponse = {
  type: 'object',
  properties: {
    cameraId: { type: 'string' },
    enabled: { type: 'boolean' },
    sensitivity: { enum: ['low', 'medium', 'high'] },
    cooldownSec: { type: 'integer' },
    arming: motionArming,
    record: { type: 'boolean' },
  },
  required: ['cameraId', 'enabled', 'sensitivity', 'cooldownSec', 'arming', 'record'],
} as const;

export const getMotionConfigSchema = {
  params: idParams,
  response: { 200: motionConfigResponse },
} as const;

export const updateMotionConfigSchema = {
  params: idParams,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      enabled: { type: 'boolean' },
      sensitivity: { enum: ['low', 'medium', 'high'] },
      cooldownSec: { type: 'integer', minimum: 5, maximum: 3600 },
      arming: motionArming,
      record: { type: 'boolean' },
    },
  },
  response: { 200: motionConfigResponse },
} as const;

// --- Grabación de clips (US-187) ---

const recordingResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    cameraId: { type: 'string' },
    cameraName: { type: 'string' },
    startedAt: { type: 'string', format: 'date-time' },
    durationSec: { type: 'integer' },
    sizeBytes: { type: 'integer' },
    snapshot: { type: ['string', 'null'] },
  },
  required: ['id', 'cameraId', 'cameraName', 'startedAt', 'durationSec', 'sizeBytes', 'snapshot'],
} as const;

export const listRecordingsSchema = {
  querystring: {
    type: 'object',
    properties: { cameraId: { type: 'string', minLength: 1, maxLength: 128 } },
  },
  response: { 200: { type: 'array', items: recordingResponse } },
} as const;

export const downloadRecordingSchema = {
  params: idParams,
} as const;

export const removeRecordingSchema = {
  params: idParams,
  response: { 204: { type: 'null' }, 404: errorResponse },
} as const;

const recordingConfigResponse = {
  type: 'object',
  properties: {
    retentionDays: { type: 'integer' },
    maxTotalMb: { type: 'integer' },
    clipSeconds: { type: 'integer' },
  },
  required: ['retentionDays', 'maxTotalMb', 'clipSeconds'],
} as const;

export const getRecordingConfigSchema = {
  response: { 200: recordingConfigResponse },
} as const;

export const updateRecordingConfigSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      retentionDays: { type: 'integer', minimum: 1, maximum: 365 },
      maxTotalMb: { type: 'integer', minimum: 10, maximum: 100000 },
      clipSeconds: { type: 'integer', minimum: 3, maximum: 120 },
    },
  },
  response: { 200: recordingConfigResponse },
} as const;

export const motionEventsSchema = {
  querystring: {
    type: 'object',
    properties: { cameraId: { type: 'string', minLength: 1, maxLength: 128 } },
  },
  response: {
    200: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          cameraId: { type: 'string' },
          cameraName: { type: 'string' },
          detectedAt: { type: 'string', format: 'date-time' },
          snapshot: { type: ['string', 'null'] },
        },
        required: ['cameraId', 'cameraName', 'detectedAt', 'snapshot'],
      },
    },
  },
} as const;
