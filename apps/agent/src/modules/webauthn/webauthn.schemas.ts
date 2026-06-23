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

// El refresh token NO va en el cuerpo (US-91): viaja en la cookie httpOnly.
const tokensResponse = {
  type: 'object',
  properties: {
    accessToken: { type: 'string' },
    expiresIn: { type: 'integer' },
  },
  required: ['accessToken', 'expiresIn'],
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

const backupCodesArray = { type: 'array', items: { type: 'string' } } as const;

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
  // Al registrar la primera passkey se devuelven códigos de recuperación (US-59).
  response: {
    200: {
      type: 'object',
      properties: { credential: credentialInfo, backupCodes: backupCodesArray },
      required: ['credential'],
    },
  },
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
  response: { 204: { type: 'null' } },
} as const;

// ---- Códigos de recuperación 2FA (US-59) ----

/** `POST /api/webauthn/backup-codes` — (re)genera el lote, devuelto una sola vez. */
export const regenerateBackupCodesSchema = {
  response: {
    200: { type: 'object', properties: { codes: backupCodesArray }, required: ['codes'] },
  },
} as const;

/** `GET /api/webauthn/backup-codes` — cuántos códigos sin usar quedan. */
export const backupCodesStatusSchema = {
  response: {
    200: { type: 'object', properties: { remaining: { type: 'integer' } }, required: ['remaining'] },
  },
} as const;

/** `POST /api/webauthn/backup-codes/verify` — completa el 2FA con un código (público). */
export const backupCodeVerifySchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'mfaToken', 'code'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 254 },
      mfaToken: { type: 'string', minLength: 1 },
      code: { type: 'string', minLength: 1, maxLength: 64 },
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
