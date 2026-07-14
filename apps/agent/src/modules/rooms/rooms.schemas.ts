/** JSON Schemas de habitaciones y grupos (US-165). El enum de iconos deriva de
 * `@krakenos/types` (fuente única, AUD-17). */

import { ROOM_ICONS } from '@krakenos/types';
import { errorResponse } from '../common.schemas.js';

const icon = { type: 'string', enum: [...ROOM_ICONS] } as const;
const order = { type: 'integer', minimum: 0, maximum: 100000 } as const;

const roomResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'name', 'icon', 'order', 'createdAt'],
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    icon: { type: 'string' },
    order: { type: 'integer' },
    createdAt: { type: 'string' },
  },
} as const;

const roomWithStateResponse = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'name',
    'icon',
    'order',
    'createdAt',
    'deviceCount',
    'iotCount',
    'controllableCount',
    'onCount',
    'anyUnreachable',
    'iotDeviceIds',
  ],
  properties: {
    ...roomResponse.properties,
    deviceCount: { type: 'integer' },
    iotCount: { type: 'integer' },
    controllableCount: { type: 'integer' },
    onCount: { type: 'integer' },
    anyUnreachable: { type: 'boolean' },
    iotDeviceIds: { type: 'array', items: { type: 'string' } },
  },
} as const;

const idParam = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
} as const;

export const listRoomsSchema = {
  response: { 200: { type: 'array', items: roomWithStateResponse } },
} as const;

export const createRoomSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      icon,
      order,
    },
  },
  response: { 201: roomResponse },
} as const;

export const updateRoomSchema = {
  params: idParam,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 60 },
      icon,
      order,
    },
  },
  response: { 200: roomResponse, 404: errorResponse },
} as const;

export const deleteRoomSchema = {
  params: idParam,
  response: { 404: errorResponse },
} as const;

export const assignRoomSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'ref', 'roomId'],
    properties: {
      kind: { type: 'string', enum: ['device', 'iot'] },
      ref: { type: 'string', minLength: 1, maxLength: 128 },
      roomId: { type: ['string', 'null'], minLength: 1, maxLength: 64 },
    },
  },
  response: { 204: { type: 'null' }, 404: errorResponse },
} as const;

export const roomActionSchema = {
  params: idParam,
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
    200: {
      type: 'object',
      additionalProperties: false,
      required: ['applied', 'failed'],
      properties: {
        applied: { type: 'integer' },
        failed: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['deviceId', 'error'],
            properties: { deviceId: { type: 'string' }, error: { type: 'string' } },
          },
        },
      },
    },
    404: errorResponse,
  },
} as const;
