/** JSON Schemas de favoritos por usuario (US-170). */

const FAVORITE_KINDS = ['device', 'iot', 'room', 'scene'] as const;

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
      kind: { type: 'string', enum: FAVORITE_KINDS },
      ref: { type: 'string', minLength: 1, maxLength: 128 },
      order: { type: 'integer', minimum: 0, maximum: 100000 },
    },
  },
  response: { 201: favoriteResponse },
} as const;

export const deleteFavoriteSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', minLength: 1 } },
  },
  response: { 204: { type: 'null' } },
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
