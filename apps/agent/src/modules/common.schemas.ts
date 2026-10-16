import { GATEWAY_CAPABILITY_REASONS, GATEWAY_CAPABILITY_STATUSES } from '@krakenos/types';

/**
 * Schemas de respuesta compartidos entre módulos.
 */

/**
 * Cuerpo de una respuesta de error (`{ code, message }`).
 *
 * Declararlo en el `response` de una ruta es necesario en Fastify 5: la reply se
 * tipa por los códigos de estado declarados en el schema, de modo que enviar un
 * 4xx exige que ese código figure aquí (y de paso valida/serializa el cuerpo del
 * error de forma consistente).
 */
export const errorResponse = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['code', 'message'],
} as const;

/**
 * Capacidad de puerta de enlace de este equipo (`GatewayCapability`). Enums derivados de las
 * listas de `@krakenos/types`: `additionalProperties:false` poda en silencio, así que un campo
 * que se añade al tipo y no aquí desaparece de camino al navegador.
 */
export const gatewayCapabilitySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: [...GATEWAY_CAPABILITY_STATUSES] },
    reason: { type: 'string', enum: [...GATEWAY_CAPABILITY_REASONS] },
  },
  required: ['status'],
} as const;

/** `GET /status` de cortafuegos y QoS: solo la capacidad (las reglas son un array). */
export const gatewayStatusSchema = {
  response: {
    200: {
      type: 'object',
      additionalProperties: false,
      properties: { capability: gatewayCapabilitySchema },
      required: ['capability'],
    },
  },
} as const;
