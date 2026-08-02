import type { IntegrationConfigValues, IntegrationDomain } from '@krakenos/types';
import type { IntegrationConfigStore } from './integration-config.store.js';
import { iotBackends } from './schema.js';

/**
 * Guarda la config de un dominio. `iot` es **aditivo**: como un hogar puede tener
 * varios backends a la vez (luces + enchufes…), guardar un backend lo **une** al CSV
 * de kinds y conserva los valores (y secretos ya descifrados) del resto de backends,
 * en vez de reemplazar todo el dominio. El resto de dominios se guardan tal cual.
 *
 * Vive aquí, y no dentro de las rutas de integraciones, porque desde US-249 tiene
 * **dos** consumidores: el asistente (`PUT /api/integrations/:domain`) y la adopción
 * de un toque desde el descubrimiento. Duplicar la semántica aditiva en el segundo
 * habría sido la forma más fácil de que un alta rápida borrara el backend de al lado.
 */
export async function saveDomainConfig(
  store: IntegrationConfigStore,
  domain: IntegrationDomain,
  kind: string,
  config: IntegrationConfigValues,
  enabled: boolean,
): Promise<void> {
  if (domain !== 'iot') {
    await store.save(domain, kind, config, enabled);
    return;
  }
  const existing = await store.getDecrypted('iot');
  const backends = new Set<string>(existing ? iotBackends(existing.kind) : []);
  for (const backend of iotBackends(kind)) backends.add(backend);
  // Parte de los valores ya descifrados (secretos en claro) y superpone los nuevos;
  // `store.save` los vuelve a cifrar, así ningún backend previo pierde su secreto.
  const mergedValues: IntegrationConfigValues = { ...(existing?.values ?? {}), ...config };
  await store.save('iot', [...backends].join(','), mergedValues, enabled);
}
