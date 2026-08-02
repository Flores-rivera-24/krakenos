import { errorResponse } from '../common.schemas.js';

/** JSON Schemas del auto-descubrimiento de IoT (US-175 · adopción US-249). */

const suggestion = {
  type: 'object',
  additionalProperties: false,
  required: [
    'id',
    'domain',
    'kind',
    'label',
    'ip',
    'hostname',
    'prefill',
    'source',
    'lastSeen',
    'adoptable',
  ],
  properties: {
    id: { type: 'string' },
    domain: { type: 'string' },
    kind: { type: 'string' },
    label: { type: 'string' },
    ip: { type: 'string' },
    hostname: { type: ['string', 'null'] },
    prefill: { type: 'object', additionalProperties: { type: 'string' } },
    source: { enum: ['mdns', 'ssdp'] },
    lastSeen: { type: 'string' },
    adoptable: { type: 'boolean' },
  },
} as const;

const statusResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions', 'scanning', 'lastScanAt'],
  properties: {
    suggestions: { type: 'array', items: suggestion },
    scanning: { type: 'boolean' },
    lastScanAt: { type: ['string', 'null'] },
  },
} as const;

export const getDiscoverySchema = {
  response: { 200: statusResponse },
} as const;

export const scanDiscoverySchema = {
  response: { 200: statusResponse },
} as const;

export const dismissSuggestionSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 200 } },
  },
  response: { 204: { type: 'null' } },
} as const;

/**
 * Alta de un toque (US-249). Devuelve el estado ya recalculado para que la UI no
 * tenga que pedirlo aparte: al adoptar, la sugerencia desaparece de la lista.
 */
export const adoptSuggestionSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1, maxLength: 200 } },
  },
  response: { 200: statusResponse, 400: errorResponse, 404: errorResponse },
} as const;
