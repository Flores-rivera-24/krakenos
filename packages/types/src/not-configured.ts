import type { IntegrationDomain } from './integrations.js';

/**
 * Kind «sin configurar» (`*_KIND=none`): el dominio no tiene ninguna integración detrás.
 *
 * Existe para que una instalación real **no enseñe datos inventados**: antes todo dominio
 * caía a `mock`, que inventa aparatos, peers VPN, reglas y cámaras como si fueran del
 * usuario. `none` devuelve lecturas **vacías declaradas** (el estado viaja con los datos) y
 * rechaza las escrituras con 409 `DOMAIN_NOT_CONFIGURED`. El default de `env.ts` sigue siendo
 * `mock` (dev y tests no cambian); es `install.sh` quien escribe `none` en el `.env` real.
 */
export const NOT_CONFIGURED_KIND = 'none' as const;
export type NotConfiguredKind = typeof NOT_CONFIGURED_KIND;

/** Código de error de una escritura contra un dominio sin configurar (HTTP 409). */
export const DOMAIN_NOT_CONFIGURED_CODE = 'DOMAIN_NOT_CONFIGURED' as const;

/**
 * Estado de un dominio de integración, calculado en un punto único del agente:
 * - `configured` — hay una integración real detrás (o el usuario la guardó).
 * - `demo` — `mock`: los datos son de demostración, no de la casa del usuario.
 * - `not-configured` — `none`: no hay nada conectado; la UI invita a conectarlo.
 */
export const DOMAIN_STATES = ['configured', 'demo', 'not-configured'] as const;
export type DomainState = (typeof DOMAIN_STATES)[number];

/** Estado de los ocho dominios. `Record` exhaustivo: un dominio nuevo no compila sin estado. */
export type IntegrationStates = Record<IntegrationDomain, DomainState>;

/** Respuesta de `GET /api/integrations/status`: lectura autenticada mínima, para todos los roles. */
export interface IntegrationStatesResponse {
  states: IntegrationStates;
}

/**
 * Marca que llevan las implementaciones `none` de los managers. Opcional en la interfaz:
 * los managers reales y `mock` simplemente no la tienen. Un servicio de fondo que no debe
 * sondear lo que no existe (barrido de inventario, muestreo de tráfico, alarma) la mira en el
 * `handle` recargable, que la deja pasar.
 */
export interface NotConfigurable {
  readonly notConfigured?: true;
}
