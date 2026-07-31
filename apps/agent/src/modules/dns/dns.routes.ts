import type { AddBlockedDomainRequest, DnsManager, UpdateDnsFeedRequest } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { DnsError } from '../../dns/mock.dns.js';
import {
  addBlockedSchema,
  dnsStatsSchema,
  listBlockedSchema,
  listFeedsSchema,
  recentQueriesSchema,
  removeBlockedSchema,
  updateFeedSchema,
} from './dns.schemas.js';

interface DnsRoutesOpts {
  dns: DnsManager;
}

export const dnsRoutes: FastifyPluginAsync<DnsRoutesOpts> = async (app, opts) => {
  const { dns } = opts;

  // Lectura: cualquier usuario autenticado. Escritura: solo admin.
  app.addHook('preHandler', app.authenticate);
  const adminOnly = app.requireRole('admin');
  /**
   * El registro de consultas es la excepción (US-250): lo que se ve ahí es a qué
   * dominios habla cada aparato, o sea el historial de navegación del hogar. Sale
   * de «lectura autenticada» y pasa a la capacidad `home.activity` (solo admin, y
   * fuera del alcance de cualquier token de API). Los agregados de esta ruta
   * —totales, blocklist y feeds— se quedan como lectura autenticada: son cifras y
   * configuración, no el comportamiento de una persona.
   */
  const canSeeActivity = app.requireCapability('home.activity');

  app.get('/stats', { schema: dnsStatsSchema }, async () => {
    return dns.getStats();
  });

  app.get('/blocklist', { schema: listBlockedSchema }, async () => {
    return dns.listBlocked();
  });

  app.get<{ Querystring: { limit?: number } }>(
    '/queries',
    { schema: recentQueriesSchema, preHandler: canSeeActivity },
    async (req) => {
      return dns.recentQueries(req.query.limit);
    },
  );

  app.post<{ Body: AddBlockedDomainRequest }>(
    '/blocklist',
    { schema: addBlockedSchema, preHandler: adminOnly },
    async (req, reply) => {
      try {
        const entry = await dns.addBlocked(req.body.domain);
        app.audit({ action: 'dns.block.add', userId: req.user.sub, detail: entry.domain, ip: req.ip });
        return reply.code(201).send(entry);
      } catch (err) {
        if (err instanceof DnsError && err.code === 'DOMAIN_EXISTS') {
          return reply.code(409).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/blocklist/:id',
    { schema: removeBlockedSchema, preHandler: adminOnly },
    async (req, reply) => {
      const removed = await dns.removeBlocked(req.params.id);
      if (!removed) {
        return reply.code(404).send({ code: 'DOMAIN_NOT_FOUND', message: 'Dominio no encontrado' });
      }
      app.audit({ action: 'dns.block.remove', userId: req.user.sub, detail: req.params.id, ip: req.ip });
      return reply.code(204).send();
    },
  );

  // Feeds de categoría / adlists (US-114).
  app.get('/feeds', { schema: listFeedsSchema }, async () => dns.listFeeds());

  app.patch<{ Params: { id: string }; Body: UpdateDnsFeedRequest }>(
    '/feeds/:id',
    { schema: updateFeedSchema, preHandler: adminOnly },
    async (req, reply) => {
      try {
        const feed = await dns.setFeedEnabled(req.params.id, req.body.enabled);
        app.audit({
          action: 'dns.feed.update',
          userId: req.user.sub,
          detail: `${feed.id}=${feed.enabled}`,
          ip: req.ip,
        });
        return reply.send(feed);
      } catch (err) {
        if (err instanceof DnsError && err.code === 'FEED_UNKNOWN') {
          return reply.code(404).send({ code: err.code, message: err.message });
        }
        throw err;
      }
    },
  );
};
