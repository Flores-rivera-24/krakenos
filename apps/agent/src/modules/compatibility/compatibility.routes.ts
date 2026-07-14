import { COMPAT_CATEGORIES } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { buildCompatibilityCatalog } from './compatibility.catalog.js';

/** El catálogo es estático (derivado del código): se construye una vez. */
const CATALOG = buildCompatibilityCatalog();

const compatibilitySchema = {
  response: {
    200: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          category: { type: 'string', enum: [...COMPAT_CATEGORIES] },
          label: { type: 'string' },
          capabilities: { type: 'array', items: { type: 'string' } },
          requirements: { type: 'array', items: { type: 'string' } },
          verified: { type: 'boolean' },
        },
        required: ['id', 'category', 'label', 'capabilities', 'requirements', 'verified'],
      },
    },
  },
} as const;

/**
 * Consulta de compatibilidad de hardware (US-208). Lectura autenticada. El
 * catálogo se **deriva del código** (integraciones + drivers), así que se mantiene
 * al día solo al añadir un backend.
 */
export const compatibilityRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', { preHandler: app.authenticate, schema: compatibilitySchema }, () => CATALOG);
};
