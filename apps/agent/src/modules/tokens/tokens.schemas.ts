import { API_TOKEN_SCOPES } from '@krakenos/types';
import { errorResponse } from '../common.schemas.js';

const scopeEnum = [...API_TOKEN_SCOPES];

const apiTokenInfo = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    prefix: { type: 'string' },
    scopes: { type: 'array', items: { type: 'string', enum: scopeEnum } },
    role: { type: 'string' },
    lastUsedAt: { type: ['string', 'null'] },
    expiresAt: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
  },
  required: ['id', 'name', 'prefix', 'scopes', 'role', 'lastUsedAt', 'expiresAt', 'createdAt'],
} as const;

export const listTokensSchema = {
  response: { 200: { type: 'array', items: apiTokenInfo } },
} as const;

export const createTokenSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'scopes'],
    properties: {
      name: { type: 'string', minLength: 1, maxLength: 64 },
      scopes: {
        type: 'array',
        minItems: 1,
        items: { type: 'string', enum: scopeEnum },
      },
      // Caducidad opcional en días (máx 5 años).
      expiresInDays: { type: 'integer', minimum: 1, maximum: 1825 },
    },
  },
  response: {
    201: {
      type: 'object',
      additionalProperties: false,
      properties: { ...apiTokenInfo.properties, token: { type: 'string' } },
      required: [...apiTokenInfo.required, 'token'],
    },
    400: errorResponse,
    403: errorResponse,
  },
} as const;

export const deleteTokenSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  response: { 204: { type: 'null' }, 403: errorResponse, 404: errorResponse },
} as const;
