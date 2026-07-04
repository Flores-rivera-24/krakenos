/**
 * Validación de egress (SSRF) de la config de integraciones en el **borde de
 * configuración**: al guardar o probar una integración, sus campos de red
 * (`url`/`host`/`ip`) se comprueban contra la política de egress, de modo que un
 * admin no pueda apuntar una integración a la metadata de nube (`169.254.169.254`)
 * ni —en modo estricto— a la red interna del host.
 *
 * Se valida aquí (entrada de la URL) y de forma **lenient con la resolución DNS**:
 * un dispositivo LAN puede estar apagado al guardar, así que un host que no resuelve
 * no se rechaza; solo se bloquea un literal prohibido o un nombre que **resuelve** a
 * un destino prohibido.
 */
import { isIP } from 'node:net';
import type { IntegrationConfigValues, IntegrationDomain } from '@krakenos/types';
import { assertHostAllowed, extractHost, type EgressPolicy } from '../net/egress.js';
import { fieldTypeFor } from './schema.js';

/** Tipos de campo que representan un destino de red. */
const NETWORK_FIELD_TYPES = new Set(['url', 'host', 'ip']);

/**
 * Recorre los valores de una config y valida los campos de red **con una IP
 * literal** contra la política de egress. Lanza `EgressBlockedError` en el primer
 * destino prohibido (p. ej. `http://169.254.169.254`).
 *
 * **Solo literales, a propósito:** este control corre en el borde de guardado; hacer
 * una resolución DNS aquí bloquearía por segundos (o colgaría) al guardar la config
 * de un dispositivo LAN apagado, y aun así la resolución podría rebindarse antes de
 * la petición real. El ataque realista contra el modelo actual (un admin pega una
 * URL a metadata) usa una IP literal y sí se corta aquí. La validación de **hostnames
 * en runtime** (resolver + pin) es el control para multi-tenant y vive en `safeFetch`
 * (`net/egress.ts`), ya usado por la comprobación de actualizaciones y adoptable por
 * los transportes.
 */
export async function assertConfigEgressAllowed(
  domain: IntegrationDomain,
  config: IntegrationConfigValues,
  policy: EgressPolicy,
): Promise<void> {
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string' || value.trim() === '') continue;
    const type = fieldTypeFor(domain, key);
    if (!type || !NETWORK_FIELD_TYPES.has(type)) continue;
    const host = extractHost(value);
    // Solo IPs literales en el borde; los hostnames se validan en runtime.
    if (!host || isIP(host) === 0) continue;
    await assertHostAllowed(host, policy);
  }
}
