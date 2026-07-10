import type { FastifyPluginAsync } from 'fastify';
import type { DiscoveryService } from './discovery.service.js';
import {
  dismissSuggestionSchema,
  getDiscoverySchema,
  scanDiscoverySchema,
} from './discovery.schemas.js';

interface DiscoveryRoutesOpts {
  service: DiscoveryService;
}

/**
 * Auto-descubrimiento de IoT (US-175). Lectura = autenticado; disparar el
 * barrido y descartar sugerencias = admin y auditado (regla general de
 * escritura). El sondeo es solo LAN (multicast TTL 1, garantizado por el
 * transporte) — nunca sale nada fuera.
 */
export const discoveryRoutes: FastifyPluginAsync<DiscoveryRoutesOpts> = async (app, opts) => {
  const { service } = opts;
  const adminOnly = app.requireRole('admin');

  app.get('/', { schema: getDiscoverySchema, preHandler: app.authenticate }, async () =>
    service.status(),
  );

  // Barrido bajo demanda («Buscar dispositivos»). Con coalescing: si ya hay uno
  // en curso, se devuelve el estado actual sin lanzar otro.
  app.post('/scan', { schema: scanDiscoverySchema, preHandler: adminOnly }, async (req) => {
    await service.scanCycle();
    app.audit({ action: 'discovery.scan', userId: req.user.sub, ip: req.ip });
    return service.status();
  });

  app.delete<{ Params: { id: string } }>(
    '/suggestions/:id',
    { schema: dismissSuggestionSchema, preHandler: adminOnly },
    async (req, reply) => {
      await service.dismiss(req.params.id);
      app.audit({
        action: 'discovery.dismiss',
        userId: req.user.sub,
        detail: req.params.id,
        ip: req.ip,
      });
      return reply.code(204).send();
    },
  );
};
