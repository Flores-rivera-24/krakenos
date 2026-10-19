import { existsSync } from 'node:fs';
import {
  DOMAIN_NOT_CONFIGURED_CODE,
  NOT_CONFIGURED_KIND,
  type GatewayCapability,
} from '@krakenos/types';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { DOMAIN_NOT_CONFIGURED_MESSAGE } from '../integrations/not-configured.js';

/**
 * Capacidad de **este equipo** para hacer de puerta de enlace (VPN WireGuard, cortafuegos
 * iptables, QoS tc). Las tres delegan en el helper privilegiado de Linux
 * (`privileged/runner.ts`), así que la respuesta depende de la plataforma y de si el helper
 * está instalado, no de lo que el usuario haya configurado.
 *
 * Es una función **pura**: plataforma y comprobación de fichero se inyectan, y los tests
 * recorren la tabla plataforma × kind × helper.
 *
 * - `win32` → `unsupported`/`platform`, **sea cual sea el kind**: en Windows no hay helper ni
 *   `wg`/`iptables`/`tc`, y un `mock` ahí tampoco hace de puerta de enlace.
 * - Resto de plataformas con un kind real y el helper inexistente → `requires-setup`/
 *   `helper-missing`.
 * - Todo lo demás → `supported`. La honestidad del `mock` en sí (que es un simulacro) no se
 *   resuelve aquí.
 */
export interface GatewayCapabilityInput {
  /** Kind vivo del gestor (`mock`, `wireguard`, `iptables`, `tc`). */
  kind: string;
  /** Ruta del helper configurada para este dominio (`WG_HELPER_PATH`, `FW_…`, `TC_…`). */
  helperPath: string;
  platform?: NodeJS.Platform;
  pathExists?: (path: string) => boolean;
}

export function resolveGatewayCapability(input: GatewayCapabilityInput): GatewayCapability {
  const platform = input.platform ?? process.platform;
  if (platform === 'win32') return { status: 'unsupported', reason: 'platform' };
  if (input.kind === NOT_CONFIGURED_KIND)
    return { status: 'not-configured', reason: 'not-configured' };
  if (input.kind === 'mock') return { status: 'supported' };
  const exists = input.pathExists ?? existsSync;
  if (!exists(input.helperPath)) return { status: 'requires-setup', reason: 'helper-missing' };
  return { status: 'supported' };
}

/** Lo que recibe un módulo de rutas para saber la capacidad **viva** de su gestor. */
export interface GatewayProbe {
  /** Ruta del helper de este dominio. */
  helperPath: string;
  /** Solo tests. */
  platform?: NodeJS.Platform;
  /** Solo tests. */
  pathExists?: (path: string) => boolean;
}

/**
 * Cierra la capacidad sobre el gestor (el `handle` recargable, cuyo `kind` cambia al
 * reconfigurar en caliente): se evalúa en **cada** petición, no una vez al arrancar, porque
 * el helper puede instalarse con el agente vivo.
 */
export function gatewayCapabilityOf(
  manager: { readonly kind: string },
  probe: GatewayProbe,
): () => GatewayCapability {
  return () =>
    resolveGatewayCapability({
      kind: manager.kind,
      helperPath: probe.helperPath,
      platform: probe.platform,
      pathExists: probe.pathExists,
    });
}

/**
 * Copy del agente para los dos estados que cortan una escritura. Es nuestro y no lleva
 * detalles del sistema; la web lo traduce por `code`.
 */
export const GATEWAY_BLOCK = {
  'not-configured': {
    statusCode: 409,
    code: DOMAIN_NOT_CONFIGURED_CODE,
    message: DOMAIN_NOT_CONFIGURED_MESSAGE,
  },
  unsupported: {
    statusCode: 501,
    code: 'GATEWAY_UNSUPPORTED',
    message:
      'Este equipo no puede hacer de puerta de enlace (VPN, cortafuegos o QoS). Usa los de tu router.',
  },
  'requires-setup': {
    statusCode: 503,
    code: 'GATEWAY_REQUIRES_SETUP',
    message:
      'Falta instalar el helper de puerta de enlace en este equipo: sin él no se puede aplicar el cambio.',
  },
} as const;

/**
 * `preHandler` para las rutas de **escritura** de un módulo de puerta de enlace: si el equipo
 * no puede aplicar el cambio, responde antes de tocar el almacén y sin llamar al helper.
 * (Aplicar con el helper ausente guardaba la regla en el almacén y luego fallaba: una regla
 * «creada» que nunca se aplicó.) Las lecturas pasan: sirven del almacén y la UI las necesita
 * para enseñar el aviso.
 */
export function requireGatewaySupported(capability: () => GatewayCapability) {
  return async function gatewayGuard(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply | void> {
    if (req.method === 'GET' || req.method === 'HEAD') return;
    const cap = capability();
    if (cap.status === 'supported') return;
    const block = GATEWAY_BLOCK[cap.status];
    return reply
      .code(block.statusCode)
      .send({ statusCode: block.statusCode, code: block.code, message: block.message });
  };
}
