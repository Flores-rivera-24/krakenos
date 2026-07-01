import type { FastifyPluginAsync } from 'fastify';
import type {
  IntegrationConfigValues,
  IntegrationDomain,
  SaveIntegrationConfigRequest,
} from '@krakenos/types';
import { env } from '../../config/env.js';
import type { IntegrationConfigStore } from '../../integrations/integration-config.store.js';
import type { IntegrationRuntime } from '../../integrations/runtime.js';
import {
  INTEGRATION_DOMAINS,
  getKindSchema,
  iotBackends,
  isSecretKey,
  listKinds,
} from '../../integrations/schema.js';
import { testConnection } from '../../integrations/test-connection.js';
import {
  deleteIntegrationSchema,
  overviewSchema,
  saveIntegrationSchema,
  testIntegrationSchema,
} from './integrations.schemas.js';

interface IntegrationsRoutesOpts {
  runtime: IntegrationRuntime;
  store: IntegrationConfigStore;
}

/** `kind` efectivo heredado de `.env` por dominio (cuando no hay config en DB). */
const ENV_KIND: Record<IntegrationDomain, string> = {
  driver: env.driver.kind,
  vpn: env.vpn.kind,
  iot: env.iot.kind,
  cameras: env.cameras.kind,
  firewall: env.firewall.kind,
  vlan: env.vlan.kind,
  qos: env.qos.kind,
  dns: env.dns.kind,
};

/** ¿`kind` es válido para `domain`? En `iot`, cada backend del CSV debe existir. */
function isKnownKind(domain: IntegrationDomain, kind: string): boolean {
  if (domain === 'iot') {
    const backends = iotBackends(kind);
    return backends.length > 0 && backends.every((b) => getKindSchema('iot', b) !== undefined);
  }
  return getKindSchema(domain, kind) !== undefined;
}

/**
 * Para probar/guardar tras editar solo campos no-secretos, completa los secretos
 * omitidos con los ya guardados (mismo `kind`), para no obligar a reescribir claves.
 */
async function mergeStoredSecrets(
  store: IntegrationConfigStore,
  domain: IntegrationDomain,
  kind: string,
  config: IntegrationConfigValues,
): Promise<IntegrationConfigValues> {
  const stored = await store.getDecrypted(domain);
  if (!stored || stored.kind !== kind) return config;
  const merged: IntegrationConfigValues = { ...config };
  for (const [key, value] of Object.entries(stored.values)) {
    if (isSecretKey(domain, kind, key)) {
      const provided = merged[key];
      if (provided === undefined || provided === '') merged[key] = value;
    }
  }
  return merged;
}

/**
 * Guarda la config de un dominio. `iot` es **aditivo**: como un hogar puede tener
 * varios backends a la vez (luces + enchufes…), guardar un backend lo **une** al CSV
 * de kinds y conserva los valores (y secretos ya descifrados) del resto de backends,
 * en vez de reemplazar todo el dominio. El resto de dominios se guardan tal cual.
 */
async function saveDomainConfig(
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

export const integrationsRoutes: FastifyPluginAsync<IntegrationsRoutesOpts> = async (app, opts) => {
  const { runtime, store } = opts;

  // Lectura: cualquier usuario autenticado. Escritura: solo admin.
  app.addHook('preHandler', app.authenticate);
  const adminOnly = app.requireRole('admin');

  // Catálogo de integraciones + config efectiva por dominio (secretos redactados).
  app.get('/', { schema: overviewSchema }, async () => {
    const infos = await store.list();
    const byDomain = new Map(infos.map((i) => [i.domain, i]));
    const domains = INTEGRATION_DOMAINS.map((domain) => {
      const current = byDomain.get(domain) ?? null;
      return {
        domain,
        kinds: listKinds(domain),
        current,
        effectiveKind: current?.kind ?? ENV_KIND[domain],
        source: current ? 'db' : 'env',
      };
    });
    return { domains };
  });

  // Guarda la config de un dominio (cifra secretos) y recarga el manager en caliente.
  app.put<{ Params: { domain: IntegrationDomain }; Body: SaveIntegrationConfigRequest }>(
    '/:domain',
    { schema: saveIntegrationSchema, preHandler: adminOnly },
    async (req, reply) => {
      const { domain } = req.params;
      const { kind, enabled, config } = req.body;
      if (!isKnownKind(domain, kind)) {
        return reply
          .code(400)
          .send({ code: 'UNKNOWN_KIND', message: `Integración desconocida para ${domain}: ${kind}` });
      }
      await saveDomainConfig(store, domain, kind, config, enabled ?? true);
      await runtime.reconfigure(domain);
      app.audit({ action: 'integration.save', userId: req.user.sub, detail: `${domain}:${kind}`, ip: req.ip });
      return store.getInfo(domain);
    },
  );

  // Prueba la conexión de una config propuesta (sin guardarla).
  app.post<{ Params: { domain: IntegrationDomain }; Body: SaveIntegrationConfigRequest }>(
    '/:domain/test',
    { schema: testIntegrationSchema, preHandler: adminOnly },
    async (req, reply) => {
      const { domain } = req.params;
      const { kind, config } = req.body;
      if (!isKnownKind(domain, kind)) {
        return reply
          .code(400)
          .send({ code: 'UNKNOWN_KIND', message: `Integración desconocida para ${domain}: ${kind}` });
      }
      const values = await mergeStoredSecrets(store, domain, kind, config);
      return testConnection(domain, { kind, values });
    },
  );

  // Elimina la config guardada de un dominio y vuelve al fallback de `.env`.
  app.delete<{ Params: { domain: IntegrationDomain } }>(
    '/:domain',
    { schema: deleteIntegrationSchema, preHandler: adminOnly },
    async (req, reply) => {
      const { domain } = req.params;
      await store.remove(domain);
      await runtime.reconfigure(domain);
      app.audit({ action: 'integration.remove', userId: req.user.sub, detail: domain, ip: req.ip });
      return reply.code(204).send();
    },
  );
};
