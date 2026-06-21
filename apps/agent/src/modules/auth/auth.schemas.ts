/**
 * JSON Schemas de validación para las rutas de autenticación.
 * Se mantienen alineados con los tipos de `@krakenos/types`.
 */

const userResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string', format: 'email' },
    displayName: { type: 'string' },
    role: { type: 'string', enum: ['admin', 'viewer'] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'email', 'displayName', 'role', 'createdAt', 'updatedAt'],
} as const;

const tokensResponse = {
  type: 'object',
  properties: {
    accessToken: { type: 'string' },
    refreshToken: { type: 'string' },
    expiresIn: { type: 'integer' },
  },
  required: ['accessToken', 'refreshToken', 'expiresIn'],
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

export const refreshSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['refreshToken'],
    properties: {
      refreshToken: { type: 'string', minLength: 1 },
    },
  },
  response: {
    200: tokensResponse,
  },
} as const;

export const statusSchema = {
  response: {
    200: userResponse,
  },
} as const;

export const logoutSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['refreshToken'],
    properties: {
      refreshToken: { type: 'string', minLength: 1 },
    },
  },
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

export const revokeSessionsSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    properties: { keepRefreshToken: { type: 'string', minLength: 1 } },
  },
} as const;
