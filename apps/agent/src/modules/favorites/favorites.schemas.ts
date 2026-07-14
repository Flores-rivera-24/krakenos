/** JSON Schemas de favoritos por usuario (US-170). El enum de tipos deriva de
 * `@krakenos/types` (fuente única, AUD-17). */

import { FAVORITE_KINDS } from '@krakenos/types';
import { errorResponse } from '../common.schemas.js';

const favoriteResponse = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'ref', 'order', 'createdAt'],
  properties: {
    id: { type: 'string' },
    kind: { type: 'string' },
    ref: { type: 'string' },
    order: { type: 'integer' },
    createdAt: { type: 'string' },
  },
} as const;

export const listFavoritesSchema = {
  response: { 200: { type: 'array', items: favoriteResponse } },
} as const;

export const createFavoriteSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['kind', 'ref'],
    properties: {
      kind: { type: 'string', enum: [...FAVORITE_KINDS] },
      ref: { type: 'string', minLength: 1, maxLength: 128 },
      order: { type: 'integer', minimum: 0, maximum: 100000 },
    },
  },
  response: { 201: favoriteResponse, 413: errorResponse },
} as const;

export const deleteFavoriteSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1 } },
  },
  response: { 204: { type: 'null' }, 404: errorResponse },
} as const;

export const reorderFavoritesSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['ids'],
    properties: {
      ids: { type: 'array', items: { type: 'string', minLength: 1 }, maxItems: 200 },
    },
  },
  response: { 200: { type: 'array', items: favoriteResponse } },
} as const;
