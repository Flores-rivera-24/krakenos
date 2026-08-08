/** JSON Schemas de las reglas de alerta (US-112). */

// US-270: `label` sale del contrato. Iba en español desde el agente, que no tiene
// i18n, así que la etiqueta llegaba en español a una app en inglés. Ahora viaja
// **la clave** (`event`) y el copy lo pone la web. Y se quita del schema en el
// mismo commit que del tipo: `additionalProperties:false` PODA, así que un campo
// que sobra aquí no da error — desaparece de camino al navegador, en silencio.
const alertRule = {
  type: 'object',
  additionalProperties: false,
  required: ['event', 'push', 'email', 'telegram'],
  properties: {
    event: { type: 'string' },
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
