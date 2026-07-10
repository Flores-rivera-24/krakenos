import { errorResponse } from '../common.schemas.js';

const energyBucket = {
  type: 'object',
  additionalProperties: false,
  properties: {
    timestamp: { type: 'string', format: 'date-time' },
    powerW: { type: 'number' },
    energyWh: { type: 'number' },
  },
  required: ['timestamp', 'powerW', 'energyWh'],
} as const;

const deviceEnergyStats = {
  type: 'object',
  additionalProperties: false,
  properties: {
    deviceId: { type: 'string' },
    name: { type: ['string', 'null'] },
    room: { type: ['string', 'null'] },
    energyWh: { type: 'number' },
    cost: { type: ['number', 'null'] },
    buckets: { type: 'array', items: energyBucket },
  },
  required: ['deviceId', 'name', 'room', 'energyWh', 'cost', 'buckets'],
} as const;

export const energyStatsSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: {
      range: { type: 'string', enum: ['day', 'week', 'month'], default: 'day' },
    },
  },
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      properties: {
        range: { type: 'string', enum: ['day', 'week', 'month'] },
        buckets: { type: 'array', items: energyBucket },
        totalEnergyWh: { type: 'number' },
        previousTotalEnergyWh: { type: 'number' },
        pricePerKwh: { type: ['number', 'null'] },
        currency: { type: 'string' },
        totalCost: { type: ['number', 'null'] },
        previousTotalCost: { type: ['number', 'null'] },
        devices: { type: 'array', items: deviceEnergyStats },
      },
      required: [
        'range',
        'buckets',
        'totalEnergyWh',
        'previousTotalEnergyWh',
        'pricePerKwh',
        'currency',
        'totalCost',
        'previousTotalCost',
        'devices',
      ],
    },
  },
} as const;

const energyConfig = {
  type: 'object',
  additionalProperties: false,
  properties: {
    pricePerKwh: { type: ['number', 'null'] },
    currency: { type: 'string' },
  },
  required: ['pricePerKwh', 'currency'],
} as const;

export const getEnergyConfigSchema = {
  response: { 200: energyConfig },
} as const;

export const updateEnergyConfigSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      // `null` limpia el precio (vuelve a "sin coste"); un número ≥ 0 lo fija.
      pricePerKwh: { type: ['number', 'null'], minimum: 0 },
      currency: { type: 'string', minLength: 1, maxLength: 8 },
    },
  },
  response: {
    200: energyConfig,
    400: errorResponse,
  },
} as const;
