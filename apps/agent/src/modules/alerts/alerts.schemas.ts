/** JSON Schemas de las reglas de alerta (US-112). */

const alertRule = {
  type: 'object',
  additionalProperties: false,
  required: ['event', 'label', 'push', 'email', 'telegram'],
  properties: {
    event: { type: 'string' },
    label: { type: 'string' },
    push: { type: 'boolean' },
    email: { type: 'boolean' },
    telegram: { type: 'boolean' },
  },
} as const;

export const listAlertRulesSchema = {
  response: { 200: { type: 'array', items: alertRule } },
} as const;

export const updateAlertRuleSchema = {
  params: {
    type: 'object',
    additionalProperties: false,
    required: ['event'],
    properties: { event: { type: 'string', minLength: 1 } },
  },
  body: {
    type: 'object',
    additionalProperties: false,
    minProperties: 1,
    properties: {
      push: { type: 'boolean' },
      email: { type: 'boolean' },
      telegram: { type: 'boolean' },
    },
  },
  response: { 200: alertRule },
} as const;
