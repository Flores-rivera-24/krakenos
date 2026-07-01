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
  rtspUrl: { type: 'string', minLength: 1, maxLength: 2048 },
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
  response: { 200: managedCameraResponse },
} as const;

export const removeCameraSchema = {
  params: idParams,
  response: { 204: { type: 'null' } },
} as const;
