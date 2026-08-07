import { APP_DEPENDENCY_REASONS, COMPAT_CATEGORIES, SUPPORT_LEVELS } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { buildCompatibilityCatalog } from './compatibility.catalog.js';

/** El catálogo es estático (derivado del código): se construye una vez. */
const CATALOG = buildCompatibilityCatalog();

/**
 * ⚠️ `additionalProperties: false` en una respuesta **poda** lo que no esté aquí, y
 * eso ya costó una feature entera: `support` se añadió al contrato (US-238) y no a
 * este schema, así que el sello «community · necesita la app del fabricante» **nunca
 * llegó al navegador**. El test de la web pasaba porque su fixture sí lo traía y
 * `api.get<T>()` es un cast, no una comprobación.
 *
 * Por eso hay un test de contrato (`compatibility.routes.test.ts`) que compara las
 * claves que **de verdad** salen por la ruta con las que produce el catálogo: un
 * campo nuevo en `CompatibilityEntry` que se olvide aquí pone el test en rojo en vez
 * de desaparecer en silencio.
 */
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
          verifiedAt: { type: ['string', 'null'] },
          support: { type: 'string', enum: [...SUPPORT_LEVELS] },
          appDependency: {
            type: ['object', 'null'],
            additionalProperties: false,
            properties: {
              reason: { type: 'string', enum: [...APP_DEPENDENCY_REASONS] },
              scope: { type: 'string', enum: ['all', 'some'] },
              devices: { type: 'string' },
            },
            required: ['reason', 'scope'],
          },
        },
        required: [
          'id',
          'category',
          'label',
          'capabilities',
          'requirements',
          'verifiedAt',
          'support',
          'appDependency',
        ],
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
