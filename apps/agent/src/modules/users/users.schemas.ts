import { USER_ROLES } from '@krakenos/types';

/** JSON Schemas del módulo de gestión de usuarios (US-101/US-179). */

// Derivado del array `as const` de `@krakenos/types` (fuente única, sin deriva).
const ROLE = { type: 'string', enum: USER_ROLES } as const;
const STATUS = { type: 'string', enum: ['active', 'disabled'] } as const;

/** Usuario expuesto por la API — nunca incluye el hash de contraseña. */
const userSummary = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'email', 'displayName', 'role', 'status', 'lastLoginAt', 'expiresAt', 'createdAt'],
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    displayName: { type: 'string' },
    role: ROLE,
    status: STATUS,
    lastLoginAt: { type: ['string', 'null'] },
    expiresAt: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
    // Solo en el listado (US-227): tokens de API vivos del usuario.
    apiTokenCount: { type: 'integer', minimum: 0 },
  },
} as const;

const idParam = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: { type: 'string', minLength: 1 } },
} as const;

export const listUsersSchema = {
  response: { 200: { type: 'array', items: userSummary } },
} as const;

export const createUserSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'displayName', 'password', 'role'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 254 },
      displayName: { type: 'string', minLength: 1, maxLength: 80 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
      role: ROLE,
      // Caducidad del acceso (invitados, US-179).
      expiresAt: { type: 'string', format: 'date-time' },
    },
  },
  response: { 201: userSummary },
} as const;

export const updateUserSchema = {
  params: idParam,
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      displayName: { type: 'string', minLength: 1, maxLength: 80 },
      role: ROLE,
      status: STATUS,
      expiresAt: { oneOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    },
  },
  response: { 200: userSummary },
} as const;

export const resetPasswordSchema = {
  params: idParam,
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['password'],
    properties: { password: { type: 'string', minLength: 8, maxLength: 128 } },
  },
} as const;

export const deleteUserSchema = {
  params: idParam,
} as const;
