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
