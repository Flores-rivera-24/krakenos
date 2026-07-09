import { HOME_MODES } from '@krakenos/types';

/** JSON Schemas de modos del hogar + presencia (US-169). */

const person = {
  type: 'object',
  additionalProperties: false,
  required: ['userId', 'displayName', 'home', 'since', 'deviceCount'],
  properties: {
    userId: { type: 'string' },
    displayName: { type: 'string' },
    home: { type: 'boolean' },
    since: { type: ['string', 'null'] },
    deviceCount: { type: 'integer' },
  },
} as const;

const stateResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['mode', 'modeSource', 'modeChangedAt', 'people'],
  properties: {
    mode: { enum: [...HOME_MODES] },
    modeSource: { enum: ['manual', 'presence'] },
    modeChangedAt: { type: ['string', 'null'] },
    people: { type: 'array', items: person },
  },
} as const;

const eventResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'userId', 'displayName', 'kind', 'at'],
  properties: {
    id: { type: 'string' },
    userId: { type: 'string' },
    displayName: { type: 'string' },
    kind: { enum: ['arrived', 'left'] },
    at: { type: 'string' },
  },
} as const;

export const getPresenceSchema = {
  response: { 200: stateResponse },
} as const;

export const getPresenceTimelineSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } },
  },
  response: { 200: { type: 'array', items: eventResponse } },
} as const;

export const setHomeModeSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['mode'],
    properties: { mode: { enum: [...HOME_MODES] } },
  },
  response: { 200: stateResponse },
} as const;
