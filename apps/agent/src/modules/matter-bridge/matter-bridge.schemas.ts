import { MATTER_ENDPOINT_TYPES } from '@krakenos/types';

const endpoint = {
  type: 'object',
  additionalProperties: false,
  properties: {
    deviceId: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string', enum: [...MATTER_ENDPOINT_TYPES] },
  },
  required: ['deviceId', 'name', 'type'],
} as const;

const candidate = {
  type: 'object',
  additionalProperties: false,
  properties: {
    deviceId: { type: 'string' },
    name: { type: 'string' },
    type: { type: 'string', enum: [...MATTER_ENDPOINT_TYPES] },
    exposed: { type: 'boolean' },
  },
  required: ['deviceId', 'name', 'type', 'exposed'],
} as const;

const state = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean' },
    running: { type: 'boolean' },
    commissioned: { type: 'boolean' },
    fabricCount: { type: 'integer' },
    qrCode: { type: ['string', 'null'] },
    qrDataUrl: { type: ['string', 'null'] },
    manualPairingCode: { type: ['string', 'null'] },
    endpoints: { type: 'array', items: endpoint },
    candidates: { type: 'array', items: candidate },
  },
  required: [
    'enabled',
    'running',
    'commissioned',
    'fabricCount',
    'qrCode',
    'qrDataUrl',
    'manualPairingCode',
    'endpoints',
    'candidates',
  ],
} as const;

export const getMatterBridgeSchema = {
  response: { 200: state },
} as const;

export const updateMatterBridgeSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean' },
      exposedDeviceIds: {
        type: 'array',
        maxItems: 200,
        items: { type: 'string', minLength: 1, maxLength: 128 },
      },
    },
  },
  response: { 200: state },
} as const;
