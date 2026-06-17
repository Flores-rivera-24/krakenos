import type { AddBlockedDomainRequest, DnsManager } from '@krakenos/types';
import type { FastifyPluginAsync } from 'fastify';
import { DnsError } from '../../dns/mock.dns.js';
import {
  addBlockedSchema,
  dnsStatsSchema,
  listBlockedSchema,
  recentQueriesSchema,
  removeBlockedSchema,
} from './dns.schemas.js';

interface DnsRoutesOpts {
  dns: DnsManager;
}

export const dnsRoutes: FastifyPluginAsync<DnsRoutesOpts> = async (app, opts) => {
  const { dns } = opts;

  // Lectura: cualquier usuario autenticado. Escritura: solo admin.
  app.addHook('preHandler', app.authenticate);
  const adminOnly = app.requireRole('admin');

  app.get('/stats', { schema: dnsStatsSchema }, async () => {
    return dns.getStats();
  });

  app.get('/blocklist', { schema: listBlockedSchema }, async () => {
    return dns.listBlocked();
  });

  app.get<{ Querystring: { limit?: number } }>(
    '/queries',
    { schema: recentQueriesSchema },
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
};
