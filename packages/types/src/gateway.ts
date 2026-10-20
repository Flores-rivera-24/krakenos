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
 * - `not-configured` — el dominio está en `none`: nada conectado todavía (una instalación
 *   nueva). Es el MISMO aviso que el de «sin configurar» de los demás dominios, no un segundo:
 *   la página enseña uno solo. Gana la plataforma (`unsupported`) y, después, esto: antes de
 *   hablar del helper hay que conectar el dominio.
 */
export const GATEWAY_CAPABILITY_STATUSES = [
  'supported',
  'unsupported',
  'requires-setup',
  'not-configured',
] as const;
export type GatewayCapabilityStatus = (typeof GATEWAY_CAPABILITY_STATUSES)[number];

/** Por qué no está disponible. Claves estables y sin copy: el texto lo pone la web. */
export const GATEWAY_CAPABILITY_REASONS = ['platform', 'helper-missing', 'not-configured'] as const;
export type GatewayCapabilityReason = (typeof GATEWAY_CAPABILITY_REASONS)[number];

export type GatewayCapability =
  | { status: 'supported'; reason?: undefined }
  | { status: 'unsupported'; reason: 'platform' }
  | { status: 'requires-setup'; reason: 'helper-missing' }
  | { status: 'not-configured'; reason: 'not-configured' };

/** Respuesta de `GET /api/firewall/status` y `GET /api/qos/status`. */
export interface GatewayStatusResponse {
  capability: GatewayCapability;
}
