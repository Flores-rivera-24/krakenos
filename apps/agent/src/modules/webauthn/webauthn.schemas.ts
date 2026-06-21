/**
 * JSON Schemas de las rutas WebAuthn (US-50). Los objetos de ceremonia
 * (`options`/`response`) son estructuras complejas del estándar W3C que valida la
 * librería `@simplewebauthn/*`; aquí se tratan como objetos opacos.
 */

/** Objeto WebAuthn opaco (options o response de la ceremonia). */
const opaqueObject = { type: 'object', additionalProperties: true } as const;

/** DTO público de una passkey (nunca incluye clave pública ni counter). */
const credentialInfo = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    deviceType: { type: 'string' },
    backedUp: { type: 'boolean' },
    createdAt: { type: 'string' },
    lastUsedAt: { type: ['string', 'null'] },
  },
  required: ['id', 'name', 'deviceType', 'backedUp', 'createdAt', 'lastUsedAt'],
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

const userResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    displayName: { type: 'string' },
    role: { type: 'string' },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
  },
  required: ['id', 'email', 'displayName', 'role', 'createdAt', 'updatedAt'],
} as const;

export const registerOptionsSchema = {
  response: { 200: opaqueObject },
} as const;

export const registerVerifySchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['response', 'name'],
    properties: {
      response: opaqueObject,
      name: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
  response: { 200: credentialInfo },
} as const;

export const authenticateOptionsSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'mfaToken'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 254 },
      // Token efímero `mfa-pending` emitido por `/auth/login` (US-51).
      mfaToken: { type: 'string', minLength: 1 },
    },
  },
  response: {
    200: {
      type: 'object',
      properties: { available: { type: 'boolean' }, options: opaqueObject },
      required: ['available'],
    },
  },
} as const;

export const authenticateVerifySchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'mfaToken', 'response'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 254 },
      // Token efímero `mfa-pending` emitido por `/auth/login` (US-51).
      mfaToken: { type: 'string', minLength: 1 },
      response: opaqueObject,
    },
  },
  response: {
    200: {
      type: 'object',
      properties: { user: userResponse, tokens: tokensResponse },
      required: ['user', 'tokens'],
    },
  },
} as const;

export const listCredentialsSchema = {
  response: { 200: { type: 'array', items: credentialInfo } },
} as const;

export const renameCredentialSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['name'],
    properties: { name: { type: 'string', minLength: 1, maxLength: 64 } },
  },
  response: { 200: credentialInfo },
} as const;

export const deleteCredentialSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
} as const;
