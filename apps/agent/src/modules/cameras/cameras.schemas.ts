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
