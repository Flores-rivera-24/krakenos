/**
 * Schemas de las dos vías de alta (US-267 / US-268).
 *
 * `additionalProperties: false` en todos los cuerpos: dos de estas rutas son
 * **públicas**, así que lo que no está declarado no entra.
 */

const errorResponse = {
  type: 'object',
  properties: { code: { type: 'string' }, message: { type: 'string' } },
} as const;

const ROLE = { type: 'string', enum: ['admin', 'member', 'kid', 'guest', 'viewer'] } as const;

const invitationResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    displayName: { type: 'string' },
    role: { type: 'string' },
    expiresAt: { type: 'string' },
    accountExpiresAt: { type: ['string', 'null'] },
    usedAt: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
    status: { type: 'string' },
  },
  required: ['id', 'email', 'displayName', 'role', 'expiresAt', 'createdAt', 'status'],
} as const;

const createInvitationResponse = {
  type: 'object',
  properties: {
    invitation: invitationResponse,
    // El token en claro viaja UNA vez: solo se guarda su hash.
    token: { type: 'string' },
    path: { type: 'string' },
  },
  required: ['invitation', 'token', 'path'],
} as const;

export const listInvitationsSchema = {
  response: { 200: { type: 'array', items: invitationResponse } },
} as const;

export const createInvitationSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'displayName', 'role'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 254 },
      displayName: { type: 'string', minLength: 1, maxLength: 80 },
      role: ROLE,
      expiresInHours: { type: 'integer', minimum: 1, maximum: 168 },
      accountExpiresAt: { type: 'string' },
    },
  },
  response: { 201: createInvitationResponse, 409: errorResponse },
} as const;

export const revokeInvitationSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  response: { 404: errorResponse },
} as const;

/** Público: lo que ve quien abre el enlace antes de aceptar. */
export const previewInvitationSchema = {
  params: {
    type: 'object',
    required: ['token'],
    properties: { token: { type: 'string', minLength: 8, maxLength: 128 } },
  },
  response: {
    200: {
      type: 'object',
      properties: {
        email: { type: 'string' },
        displayName: { type: 'string' },
        role: { type: 'string' },
        homeName: { type: 'string' },
      },
      required: ['email', 'displayName', 'role', 'homeName'],
    },
    404: errorResponse,
  },
} as const;

/** Público: la persona invitada elige SU contraseña. */
export const acceptInvitationSchema = {
  params: {
    type: 'object',
    required: ['token'],
    properties: { token: { type: 'string', minLength: 8, maxLength: 128 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['password'],
    properties: {
      password: { type: 'string', minLength: 8, maxLength: 128 },
      displayName: { type: 'string', minLength: 1, maxLength: 80 },
    },
  },
  response: { 400: errorResponse, 404: errorResponse },
} as const;

// ---------------------------------------------------------------------------

const accessRequestResponse = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string' },
    displayName: { type: 'string' },
    status: { type: 'string' },
    note: { type: ['string', 'null'] },
    createdAt: { type: 'string' },
    decidedAt: { type: ['string', 'null'] },
  },
  required: ['id', 'email', 'displayName', 'status', 'createdAt'],
} as const;

/**
 * Público. Responde **202 sin cuerpo** pase lo que pase por dentro (correo nuevo,
 * correo que ya tiene cuenta, solicitud repetida, solicitud ya rechazada): si la
 * respuesta variase, cualquiera podría averiguar desde fuera quién tiene cuenta en
 * la casa probando correos.
 */
export const createAccessRequestSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['email', 'displayName'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 254 },
      displayName: { type: 'string', minLength: 1, maxLength: 80 },
      note: { type: 'string', maxLength: 280 },
    },
  },
} as const;

export const listAccessRequestsSchema = {
  querystring: {
    type: 'object',
    properties: { status: { type: 'string', enum: ['pending', 'approved', 'rejected'] } },
  },
  response: { 200: { type: 'array', items: accessRequestResponse } },
} as const;

export const decideAccessRequestSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: { id: { type: 'string' } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['decision'],
    properties: {
      decision: { type: 'string', enum: ['approve', 'reject'] },
      role: ROLE,
    },
  },
  response: {
    200: {
      type: 'object',
      properties: { request: accessRequestResponse, invitation: createInvitationResponse },
      required: ['request'],
    },
    400: errorResponse,
    404: errorResponse,
    409: errorResponse,
  },
} as const;
