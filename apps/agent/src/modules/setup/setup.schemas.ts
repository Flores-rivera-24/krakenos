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

export const setupStatusSchema = {
  response: {
    200: {
      type: 'object',
      properties: { needsSetup: { type: 'boolean' } },
      required: ['needsSetup'],
    },
  },
} as const;

export const setupInitSchema = {
  body: {
    type: 'object',
    additionalProperties: false,
    required: ['homeName', 'email', 'displayName', 'password'],
    properties: {
      homeName: { type: 'string', minLength: 1, maxLength: 64 },
      email: { type: 'string', format: 'email', maxLength: 254 },
      displayName: { type: 'string', minLength: 1, maxLength: 80 },
      // Cuenta admin de un controlador de red: mínimo 10 y al menos una letra y un dígito.
      password: {
        type: 'string',
        minLength: 10,
        maxLength: 128,
        pattern: '(?=.*[A-Za-z])(?=.*\\d)',
      },
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
