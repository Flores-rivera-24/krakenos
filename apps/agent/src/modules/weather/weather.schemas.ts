import { WEATHER_METRICS, WEATHER_PRECISIONS } from '@krakenos/types';
import { errorResponse } from '../common.schemas.js';

/**
 * Schemas del tiempo exterior (US-254).
 *
 * ⚠️ `additionalProperties: false` en una respuesta **poda**, no valida: un campo
 * del contrato que no esté aquí desaparece de camino al navegador **sin error**
 * (le pasó a `support` desde US-238). Por eso `weatherStatus` declara los diez
 * campos de `WeatherStatus`, incluidos los que solo sirven para declarar qué se
 * envía — que son justo los que más caro salen si se pierden en silencio.
 */

const weatherReading = {
  type: 'object',
  additionalProperties: false,
  required: ['metric', 'value'],
  properties: {
    metric: { type: 'string', enum: [...WEATHER_METRICS] },
    value: { type: 'number' },
  },
} as const;

const weatherStatus = {
  type: 'object',
  additionalProperties: false,
  required: [
    'enabled',
    'precision',
    'provider',
    'locationConfigured',
    'sentLatitude',
    'sentLongitude',
    'readings',
    'lastFetchAt',
    'lastError',
  ],
  properties: {
    enabled: { type: 'boolean' },
    precision: { type: 'string', enum: [...WEATHER_PRECISIONS] },
    provider: { type: 'string' },
    locationConfigured: { type: 'boolean' },
    sentLatitude: { type: ['number', 'null'] },
    sentLongitude: { type: ['number', 'null'] },
    readings: { type: 'array', items: weatherReading },
    lastFetchAt: { type: ['string', 'null'] },
    lastError: { type: ['string', 'null'] },
  },
} as const;

export const getWeatherSchema = {
  response: { 200: weatherStatus, 401: errorResponse, 403: errorResponse },
} as const;

export const updateWeatherSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      enabled: { type: 'boolean' },
      precision: { type: 'string', enum: [...WEATHER_PRECISIONS] },
    },
  },
  response: { 200: weatherStatus, 401: errorResponse, 403: errorResponse },
} as const;
