import { errorResponse } from '../common.schemas.js';

export const vapidPublicKeySchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      properties: { publicKey: { type: 'string' } },
      required: ['publicKey'],
    },
  },
} as const;

export const subscribeSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['endpoint', 'keys'],
    properties: {
      // El esquema `https` y el destino se validan en el handler contra la política
      // de egress estricta (AUD3-01): aquí solo se acota la forma.
      endpoint: { type: 'string', minLength: 1, maxLength: 1024, pattern: '^https://' },
      keys: {
        type: 'object',
        additionalProperties: false,
        required: ['p256dh', 'auth'],
        properties: {
          p256dh: { type: 'string', maxLength: 256 },
          auth: { type: 'string', maxLength: 256 },
        },
      },
    },
  },
  response: { 204: { type: 'null' }, 400: errorResponse },
} as const;

export const unsubscribeSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['endpoint'],
    properties: {
      endpoint: { type: 'string', minLength: 1, maxLength: 1024 },
    },
  },
  response: { 204: { type: 'null' } },
} as const;
