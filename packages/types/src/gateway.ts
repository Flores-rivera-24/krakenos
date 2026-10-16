/**
 * ¿Puede **este equipo** hacer de puerta de enlace? VPN propia (WireGuard), cortafuegos
 * (iptables) y QoS (tc) son operaciones privilegiadas del sistema operativo que el agente
 * delega en un helper de Linux: donde no hay helper (Windows) o no está instalado, la función
 * no puede funcionar y la UI tiene que **decirlo**, no fingirlo ni caer en un 500 genérico.
 *
 * Mismo patrón que `PerDeviceTrafficCapability`: la capacidad se **declara** y viaja con los
 * datos (la UI no adivina justo donde se ve el vacío).
 *
 * - `supported` — este equipo puede aplicar los cambios.
 * - `unsupported` — no puede, y no hay nada que instalar (`platform`: Windows). El usuario usa
 *   la VPN, el cortafuegos o el QoS de su router.
 * - `requires-setup` — sí puede, pero falta el helper (`helper-missing`); la UI dice cómo
 *   instalarlo.
 */
export const GATEWAY_CAPABILITY_STATUSES = ['supported', 'unsupported', 'requires-setup'] as const;
export type GatewayCapabilityStatus = (typeof GATEWAY_CAPABILITY_STATUSES)[number];

/** Por qué no está disponible. Claves estables y sin copy: el texto lo pone la web. */
export const GATEWAY_CAPABILITY_REASONS = ['platform', 'helper-missing'] as const;
export type GatewayCapabilityReason = (typeof GATEWAY_CAPABILITY_REASONS)[number];

export type GatewayCapability =
  | { status: 'supported'; reason?: undefined }
  | { status: 'unsupported'; reason: 'platform' }
  | { status: 'requires-setup'; reason: 'helper-missing' };

/** Respuesta de `GET /api/firewall/status` y `GET /api/qos/status`. */
export interface GatewayStatusResponse {
  capability: GatewayCapability;
}
