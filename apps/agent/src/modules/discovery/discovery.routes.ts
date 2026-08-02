import type { FastifyPluginAsync } from 'fastify';
import { AdopcionNoPosibleError, type DiscoveryService } from './discovery.service.js';
import {
  adoptSuggestionSchema,
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

  /**
   * Alta **de un toque** desde el propio aviso (US-249). Hasta aquí el
   * descubrimiento solo proponía y el usuario tecleaba la dirección que la app
   * acababa de enseñarle. Reusa el camino del asistente (`saveDomainConfig` +
   * `reconfigure`), así que hereda el cifrado de secretos, la semántica **aditiva**
   * de `iot` y la recarga en caliente.
   */
  app.post<{ Params: { id: string } }>(
    '/suggestions/:id/adopt',
    { schema: adoptSuggestionSchema, preHandler: adminOnly },
    async (req, reply) => {
      try {
        const adopted = await service.adopt(req.params.id);
        if (!adopted) {
          return reply.code(404).send({
            code: 'SUGGESTION_NOT_FOUND',
            message: 'Esa sugerencia ya no está disponible. Vuelve a buscar dispositivos.',
          });
        }
        app.audit({
          action: 'discovery.adopt',
          userId: req.user.sub,
          detail: `${adopted.domain}:${adopted.kind} · ${req.params.id}`,
          ip: req.ip,
        });
        return service.status();
      } catch (err) {
        if (err instanceof AdopcionNoPosibleError) {
          // No es un fallo: es que ese aparato necesita algo que no se puede
          // descubrir (el bridge Hue, su botón). La UI abre el asistente.
          return reply.code(400).send({
            code: 'DISCOVERY_NEEDS_INPUT',
            message: 'Este dispositivo necesita datos que solo puedes dar tú. Ábrelo en el asistente.',
          });
        }
        throw err;
      }
    },
  );

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
