import { ENERGY_ALERT_METRICS } from '@krakenos/types';
import { errorResponse } from '../common.schemas.js';

const rule = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    deviceId: { type: 'string' },
    metric: { type: 'string', enum: [...ENERGY_ALERT_METRICS] },
    threshold: { type: 'number' },
    sustainMinutes: { type: 'integer' },
    enabled: { type: 'boolean' },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'deviceId', 'metric', 'threshold', 'sustainMinutes', 'enabled', 'createdAt'],
} as const;

export const listEnergyAlertsSchema = {
  response: { 200: { type: 'array', items: rule } },
} as const;

export const createEnergyAlertSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['deviceId', 'metric', 'threshold'],
    properties: {
      deviceId: { type: 'string', minLength: 1, maxLength: 128 },
      metric: { type: 'string', enum: [...ENERGY_ALERT_METRICS] },
      // Umbral acotado: hasta 100 kW / 1000 kWh cubre cualquier hogar sin permitir absurdos.
      threshold: { type: 'number', minimum: 0, maximum: 1_000_000 },
      sustainMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
      enabled: { type: 'boolean' },
    },
  },
  response: { 201: rule, 400: errorResponse },
} as const;

export const updateEnergyAlertSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: {
      metric: { type: 'string', enum: [...ENERGY_ALERT_METRICS] },
      threshold: { type: 'number', minimum: 0, maximum: 1_000_000 },
      sustainMinutes: { type: 'integer', minimum: 1, maximum: 1440 },
      enabled: { type: 'boolean' },
    },
  },
  response: { 200: rule, 404: errorResponse },
} as const;

export const deleteEnergyAlertSchema = {
  response: { 404: errorResponse },
} as const;
