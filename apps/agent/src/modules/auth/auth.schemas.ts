/**
 * JSON Schemas de validación para las rutas de autenticación.
 * Se mantienen alineados con los tipos de `@krakenos/types`.
 */
import { errorResponse } from '../common.schemas.js';
import { LOCALES, UI_MODES, USER_ROLES } from '@krakenos/types';

const userResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string', format: 'email' },
    displayName: { type: 'string' },
    role: { type: 'string', enum: USER_ROLES },
    uiMode: { type: 'string', enum: UI_MODES },
    locale: { type: 'string', enum: LOCALES },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'email', 'displayName', 'role', 'uiMode', 'locale', 'createdAt', 'updatedAt'],
} as const;

// El refresh token NO va en el cuerpo (US-91): viaja en la cookie httpOnly.
const tokensResponse = {
  type: 'object',
  properties: {
    accessToken: { type: 'string' },
    expiresIn: { type: 'integer' },
  },
  required: ['accessToken', 'expiresIn'],
} as const;

export const loginSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'password'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 254 },
      password: { type: 'string', minLength: 8, maxLength: 128 },
    },
  },
  response: {
    // O sesión emitida ({ user, tokens }) o requerimiento de 2FA WebAuthn (US-50).
    200: {
      oneOf: [
        {
          type: 'object',
          properties: { user: userResponse, tokens: tokensResponse },
          required: ['user', 'tokens'],
        },
        {
          type: 'object',
          properties: {
            requiresWebAuthn: { type: 'boolean' },
            email: { type: 'string' },
            mfaToken: { type: 'string' },
          },
          required: ['requiresWebAuthn', 'email', 'mfaToken'],
        },
      ],
    },
  },
} as const;

// El refresh token llega por la cookie httpOnly (US-91), no por el cuerpo.
export const refreshSchema = {
  response: {
    200: tokensResponse,
    401: errorResponse,
  },
} as const;

export const statusSchema = {
  response: {
    200: userResponse,
    401: errorResponse,
  },
} as const;

// Logout: el refresh token a revocar llega por la cookie httpOnly (US-91).
export const logoutSchema = {
  response: { 204: { type: 'null' } },
} as const;

/** `GET /api/auth/last-session` — último login exitoso (público, US-49). */
export const lastSessionSchema = {
  response: {
    200: {
      type: ['object', 'null'],
      properties: {
        timestamp: { type: 'string', format: 'date-time' },
        ip: { type: 'string' },
      },
      required: ['timestamp', 'ip'],
    },
  },
} as const;

const sessionItem = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    createdAt: { type: 'string' },
    expiresAt: { type: 'string' },
  },
  required: ['id', 'createdAt', 'expiresAt'],
} as const;

export const listSessionsSchema = {
  querystring: {
    type: 'object',
    additionalProperties: false,
    properties: { userId: { type: 'string' } },
  },
  response: { 200: { type: 'array', items: sessionItem } },
} as const;

// Cierra las demás sesiones; la actual se identifica por la cookie (US-91), sin cuerpo.
export const revokeSessionsSchema = {
  response: { 204: { type: 'null' } },
} as const;

/** Cambio del modo de interfaz propio (US-176) — autoservicio, solo presentación. */
export const updateUiModeSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['uiMode'],
    properties: { uiMode: { type: 'string', enum: UI_MODES } },
  },
  response: { 200: userResponse },
} as const;

/** Cambio del idioma de interfaz propio (US-177) — autoservicio, solo presentación. */
export const updateLocaleSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['locale'],
    properties: { locale: { type: 'string', enum: LOCALES } },
  },
  response: { 200: userResponse },
} as const;

/** Cambio de la propia contraseña (US-101): exige la actual + la nueva. */
export const changePasswordSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['currentPassword', 'newPassword'],
    properties: {
      currentPassword: { type: 'string', minLength: 8, maxLength: 128 },
      newPassword: { type: 'string', minLength: 8, maxLength: 128 },
    },
  },
  response: { 204: { type: 'null' } },
} as const;
