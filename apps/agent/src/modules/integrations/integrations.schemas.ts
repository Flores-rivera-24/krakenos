import { INTEGRATION_DOMAINS } from '../../integrations/schema.js';

/**
 * Objeto de valores de config: claves arbitrarias con valores primitivos. Se usa el
 * **union type** (`type: [...]`) a propósito y NO `anyOf`: con `coerceTypes` de Ajv,
 * `anyOf` coacciona un número al primer branch (string) — el union no coacciona.
 */
const configObject = {
  type: 'object',
  additionalProperties: { type: ['string', 'number', 'boolean'] },
};

const domainParams = {
  type: 'object',
  required: ['domain'],
  additionalProperties: false,
  properties: {
    domain: { type: 'string', enum: [...INTEGRATION_DOMAINS] },
  },
};

const saveBody = {
  type: 'object',
  required: ['kind', 'config'],
  additionalProperties: false,
  properties: {
    kind: { type: 'string', minLength: 1, maxLength: 200 },
    enabled: { type: 'boolean' },
    config: configObject,
  },
};

/** GET /api/integrations — catálogo + config efectiva por dominio. */
export const overviewSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      properties: {
        // Se deja permisivo (additionalProperties) para no recortar el catálogo dinámico.
        domains: { type: 'array', items: { type: 'object', additionalProperties: true } },
      },
    },
  },
};

/** PUT /api/integrations/:domain — guardar config + recargar. */
export const saveIntegrationSchema = {
  params: domainParams,
  body: saveBody,
  response: { 200: { type: 'object', additionalProperties: true } },
};

/** POST /api/integrations/:domain/test — probar la conexión propuesta. */
export const testIntegrationSchema = {
  params: domainParams,
  body: saveBody,
  response: { 200: { type: 'object', additionalProperties: true } },
};

/** DELETE /api/integrations/:domain — volver a la config de `.env`. */
export const deleteIntegrationSchema = {
  params: domainParams,
  response: { 204: { type: 'null' } },
};
